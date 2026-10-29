from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import sys
import uuid
import wave
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
from safetensors import safe_open
import folder_paths
import comfy.utils
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ImageToVideo, MiniMaxH3ReferenceToVideo


def upstream():
    # ComfyUI imports custom nodes under its own module names. Reuse that module;
    # importing the package again would register its HTTP routes twice.
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", "") or ""
        if Path(filename).name == "nodes.py" and Path(filename).parent.name == "ComfyUI-MiniMaxH3Mod":
            return module
    raise ValueError("MiniMaxH3Mod is not loaded. Install the pinned dependency and restart ComfyUI.")


def resolve_registered(file):
    p = Path(file).resolve(strict=True)
    roots = list(folder_paths.get_folder_paths("refmods"))
    roots += [str(Path(folder_paths.models_dir) / "audio_refmods"),
              str(Path(__file__).resolve().parent.parent / "ComfyUI-MiniMaxH3Mod" / "mods")]
    if not any(p.is_relative_to(Path(root).resolve()) for root in roots):
        raise ValueError("RefMod is outside the registered model folders.")
    if p.suffix != ".safetensors":
        raise ValueError("Expected a safetensors RefMod.")
    return p


class StudioH3RefModLoad:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"settings": ("STRING", {"multiline": True})}}
    RETURN_TYPES = ("H3_REF_MODS",)
    FUNCTION = "load"
    CATEGORY = "MiniMax Studio/RefMods"

    @classmethod
    def IS_CHANGED(cls, settings):
        spec = json.loads(settings)
        return [(str(p), os.stat(p).st_size, os.stat(p).st_mtime_ns)
                for p in spec.get("files", {}).values()]

    def load(self, settings):
        spec = json.loads(settings)
        package = upstream()
        core = sys.modules[package.__package__ + ".core"]
        bundle = sys.modules[package.__package__ + ".bundle"]
        mods = []
        for item in spec["items"]:
            if not item["enabled"] or item["strength"] == 0 or item["entryId"] not in spec["files"]:
                continue
            p = resolve_registered(spec["files"][item["entryId"]])
            expected = spec.get("versions", {}).get(item["entryId"])
            if expected:
                digest = hashlib.sha256()
                with p.open("rb") as f:
                    for chunk in iter(lambda: f.read(1024 * 1024), b""):
                        digest.update(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError(f"RefMod changed after submission: {p.name}")
            stem = str(p.with_suffix(""))
            meta = core.read_refmod_meta(stem)
            if meta.get("kind") == "bundle":
                loaded = bundle.load_bundle(stem, item["components"], item["visualStrength"], item["audioStrength"])
            else:
                mod = core.H3RefMod.load(stem)
                audio = mod.kind == "audio"
                weight = item["audioStrength"] if audio else item["visualStrength"]
                loaded = [] if not weight or (audio and item["components"] == "Visual") or (not audio and item["components"] == "Audio") else [(mod, weight)]
            for mod, weight in loaded:
                curve = spec.get("frameCurve", {})
                if mod.kind != "audio" and mod.latent_t <= 1 and curve.get("direction", "constant") != "constant" and curve.get("value", 1) == 0:
                    continue
                index = max(0, getattr(mod, "bundle_index", -1))
                selected = item.get("memberIndices")
                if selected is not None and index not in selected:
                    continue
                strength = float(weight) * float(item["strength"])
                if not math.isfinite(strength) or not 0 <= strength <= 1:
                    raise ValueError("Invalid RefMod strength")
                copies = item["copies"]
                if not isinstance(copies, int) or not 1 <= copies <= 8:
                    raise ValueError("Invalid RefMod copies")
                if strength:
                    mods.extend([(mod, strength)] * copies)
        package._check_token_budget(mods, int(spec["maxTokens"]))
        return (mods,)


def prepare_mods(mods, vae, settings):
    spec = json.loads(settings)
    package = upstream()
    c = spec["frameCurve"]
    package._check_token_budget(mods, spec["maxTokens"])
    blocks, names = [], []
    for mod, strength in mods:
        member_blocks = package._ref_blocks([(mod, strength)], spec.get("retention", 1.0), (c["direction"], c["shape"], c["value"]))
        blocks.extend(member_blocks)
        names.extend([mod.name] * len(member_blocks))
    items = []
    for block in blocks:
        kind = block["kind"]
        item = {"type": kind}
        if kind != "audio":
            pixels = vae.decode(block["latent"])
            if pixels.ndim == 5:
                pixels = pixels[0]
            if kind == "image":
                item["data"] = pixels[:1].cpu().clone()
            else:
                count = max(1, math.ceil(pixels.shape[0] * 2 / 24))
                times = [i / 2 for i in range(count)]
                indices = [min(round(t * 24), pixels.shape[0] - 1) for t in times]
                item.update(data=pixels[indices].cpu(), timestamps=times)
        items.append(item)
    return blocks, items, names


class ReferenceClip:
    """Request-local facade: one tokenizer/encoder call for raw and saved refs."""
    def __init__(self, clip, items, names):
        self.clip, self.items, self.names = clip, items, names
        self.reference_map = []

    def __getattr__(self, name):
        return getattr(self.clip, name)

    def tokenize(self, prompt, **kwargs):
        raw = kwargs.pop("minimax_ref_items", None)
        if raw is None:
            raw = [{"type": "image", "data": image} for image in kwargs.pop("images", [])]
        else:
            kwargs.pop("images", None)
        counters = {"image": 0, "video": 0, "audio": 0}
        self.reference_map = []
        for index, item in enumerate(list(raw) + self.items):
            kind = item["type"]
            counters[kind] += 1
            label = {"image": "Picture", "video": "Video", "audio": "Audio"}[kind]
            name = self.names[index-len(raw)] if index >= len(raw) and index-len(raw) < len(self.names) else f"Обычный {label} {counters[kind]}"
            self.reference_map.append({"trigger": f"<{label} {counters[kind]}>", "name": name, "kind": kind})
        return self.clip.tokenize(prompt, minimax_ref_items=list(raw) + self.items, **kwargs)


def conditioned(native, clip, vae, mods, settings, **kwargs):
    blocks, items, names = prepare_mods(mods, vae, settings)
    facade = ReferenceClip(clip, items, names)
    result = native.execute(clip=facade, vae=vae, **kwargs).result
    positive, latent = result
    positive = [[embedding, {**metadata, "minimax_refs": list(metadata.get("minimax_refs", [])) + blocks}]
                for embedding, metadata in positive]
    raw_tokens = sum(int(block.get("ref_audio_t", 0)) * 2 +
                     (int(block.get("latent_t", 1)) * int(block.get("latent_h", 0)) * int(block.get("latent_w", 0)) // 4)
                     for block in positive[0][1].get("minimax_refs", []) if not block.get("refmod"))
    return io.NodeOutput(positive, latent, ui={"studio_refmod_map": [facade.reference_map], "studio_raw_reference_tokens": [raw_tokens]})


class StudioH3RefModReferenceToVideo(MiniMaxH3ReferenceToVideo):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id = "StudioH3RefModReferenceToVideo"
        schema.display_name = "Studio H3 · ordinary references + RefMods"
        schema.inputs += [io.Custom("H3_REF_MODS").Input("mods"), io.String.Input("settings")]
        return schema

    @classmethod
    def execute(cls, clip, vae, mods, settings, **kwargs):
        return conditioned(MiniMaxH3ReferenceToVideo, clip, vae, mods, settings, **kwargs)


class StudioH3RefModImageToVideo(MiniMaxH3ImageToVideo):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id = "StudioH3RefModImageToVideo"
        schema.display_name = "Studio H3 · frames + RefMods"
        schema.inputs += [io.Custom("H3_REF_MODS").Input("mods"), io.String.Input("settings")]
        return schema

    @classmethod
    def execute(cls, clip, vae, mods, settings, **kwargs):
        return conditioned(MiniMaxH3ImageToVideo, clip, vae, mods, settings, **kwargs)


def result_args(value):
    return value.result if hasattr(value, "result") else value


def load_audio(file):
    # Source paths are validated against the project, rather than ComfyUI input/.
    from comfy_extras.nodes_audio import load
    waveform, sample_rate = load(file)
    return {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate}


def source_file(project, name):
    root = Path(project).resolve()
    p = (root / name).resolve(strict=True)
    if not p.is_relative_to(root):
        raise ValueError("Source leaves the project folder")
    return p


class StudioH3RefModBuild:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project": ("STRING",), "output_name": ("STRING",)},
                "optional": {"vae": ("VAE",), "audio_vae": ("VAE",)}}
    RETURN_TYPES = ("STRING",)
    FUNCTION = "build"
    OUTPUT_NODE = True
    CATEGORY = "MiniMax Studio/RefMods"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def build(self, project, output_name, vae=None, audio_vae=None):
        spec = json.loads(project)
        package = upstream()
        audio_module = sys.modules[package.__package__ + ".audio"]
        bundle = sys.modules[package.__package__ + ".bundle"]
        mods = []
        for source in spec["sources"]:
            comfy.model_management.throw_exception_if_processing_interrupted()
            file = source_file(spec["directory"], source["file"])
            start, end = float(source.get("start", 0)), source.get("end")
            name = source["name"]
            if source["kind"] == "image":
                image = ImageOps.exif_transpose(Image.open(file)).convert("RGB")
                crop = source.get("crop")
                if crop:
                    x, y, w, h = [float(crop[k]) for k in ("x", "y", "width", "height")]
                    width, height = image.size
                    image = image.crop((round(x*width), round(y*height), round((x+w)*width), round((y+h)*height)))
                pixels = torch.from_numpy(np.asarray(image).copy()).float().div_(255).unsqueeze(0)
                is_video = False
            elif source["kind"] == "video":
                import cv2
                cap = cv2.VideoCapture(str(file))
                try:
                    fps = cap.get(cv2.CAP_PROP_FPS)
                    if not fps or not math.isfinite(fps):
                        raise ValueError("Video frame rate is unavailable")
                    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    final = min(total / fps, float(end)) if end is not None else total / fps
                    if final <= start:
                        raise ValueError("Empty video range")
                    # Uniformly sample the complete selected interval, retaining its end.
                    count = max(5, min(int(spec["frameLimit"]), round((final-start)*24)))
                    frames = []
                    for t in np.linspace(start, max(start, final-1/fps), count):
                        cap.set(cv2.CAP_PROP_POS_MSEC, float(t)*1000)
                        ok, frame = cap.read()
                        if not ok:
                            raise ValueError("Cannot decode selected video frame")
                        frames.append(torch.from_numpy(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).copy()).float().div_(255))
                    pixels = torch.stack(frames)
                finally:
                    cap.release()
                is_video = True
            else:
                pixels = None
                is_video = False
            if pixels is not None:
                if vae is None:
                    raise ValueError("H3 video VAE is required")
                mask = None
                if source.get("mask"):
                    mask_image = Image.open(source_file(spec["directory"], source["mask"])).convert("L")
                    if source["kind"] == "image" and source.get("crop"):
                        mw,mh=mask_image.size
                        mask_image=mask_image.crop((round(x*mw),round(y*mh),round((x+w)*mw),round((y+h)*mh)))
                    mask = torch.from_numpy(np.asarray(mask_image).copy()).float().div_(255).unsqueeze(0)
                value = package.MiniMaxH3RefModExtract.execute(
                    name=name, mode=spec["mode"], vae=vae,
                    refs_video={"ref_video_1": pixels} if is_video else None,
                    refs_image={"ref_image_1": pixels} if not is_video else None,
                    ref_resolution=spec["resolution"], pool_h=spec["poolSize"], pool_w=spec["poolSize"],
                    latent_frames=spec["frameLimit"], identity=spec["refinementSteps"], multiplier=1,
                    max_tokens=spec["maxTokens"], budget_policy="error", mask=mask,
                    description=spec["description"], save=False)
                mods.extend(result_args(value)[0])
            if source["kind"] == "audio" or (source["kind"] == "video" and source.get("includeAudio")):
                if audio_vae is None:
                    raise ValueError("H3 audio VAE is required")
                audio = load_audio(str(file))
                rate = audio["sample_rate"]
                stop = round(float(end)*rate) if end is not None else audio["waveform"].shape[-1]
                audio = {**audio, "waveform": audio["waveform"][..., round(start*rate):stop]}
                if audio["waveform"].shape[-1] == 0:
                    raise ValueError("Empty audio range")
                duration = audio["waveform"].shape[-1] / rate
                mod = audio_module.make_audio_mod(audio_vae, audio, name + (" · звук" if pixels is not None else ""), max_seconds=duration, max_tokens=spec["maxTokens"], budget_policy="error", description=spec["description"], concept_type="generic")
                mods.append((mod, 1.0))
            package._check_token_budget(mods, spec["maxTokens"])
        if not mods:
            raise ValueError("Add sources before building a RefMod")
        root = Path(folder_paths.get_folder_paths("refmods")[0])
        target = (root / output_name).resolve()
        if not target.is_relative_to(root.resolve()) or target.with_suffix(".safetensors").exists():
            raise ValueError("Invalid output path or existing build")
        saved = bundle.save_bundle(str(target), spec["name"], mods)
        tokens = sum(mod.token_count for mod, _ in mods)
        result = {"file": saved, "name": output_name + ".safetensors", "tokens": tokens}
        # A lightweight cover comes from the source, rather than loading a VAE on library refresh.
        for src in spec["sources"]:
            if src["kind"] == "image":
                im = ImageOps.exif_transpose(Image.open(source_file(spec["directory"], src["file"]))).convert("RGB")
                im.thumbnail((320, 320)); im.save(target.with_suffix(".png")); break
        return {"ui": {"studio_refmod": [result]}, "result": (json.dumps(result),)}


class StudioH3RefModPreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"settings": ("STRING",), "full_video": ("BOOLEAN", {"default": False})},
                "optional": {"vae": ("VAE",), "audio_vae": ("VAE",)}}
    RETURN_TYPES = ("STRING",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "MiniMax Studio/RefMods"

    def preview(self, settings, full_video=False, vae=None, audio_vae=None):
        mods = StudioH3RefModLoad().load(settings)[0]
        directory = Path(folder_paths.get_output_directory()) / "refmods" / "previews"
        directory.mkdir(parents=True, exist_ok=True)
        outputs = []
        for mod, strength in mods:
            block = mod.ref_block(strength)
            name = uuid.uuid4().hex
            if mod.kind == "audio":
                from comfy_extras.nodes_audio import vae_decode_audio
                audio = vae_decode_audio(audio_vae, {"samples": block["audio_latent"]})
                if isinstance(audio, tuple): audio = audio[0]
                data=audio["waveform"][0].detach().cpu().clamp(-1,1)
                filename=name+".wav"
                with wave.open(str(directory/filename), "wb") as out:
                    out.setnchannels(data.shape[0]);out.setsampwidth(2);out.setframerate(audio["sample_rate"])
                    out.writeframes((data.T.numpy()*32767).astype(np.int16).tobytes())
            else:
                if vae is None: raise ValueError("H3 video VAE is required for preview")
                latent=block["latent"] if full_video else block["latent"][:,:,:1]
                pixels=vae.decode(latent)
                if pixels.ndim==5: pixels=pixels[0]
                frames=(pixels.detach().cpu().clamp(0,1).numpy()*255).astype(np.uint8)
                filename=name+".png"
                Image.fromarray(frames[0]).save(directory/filename)
                if full_video and len(frames)>1:
                    import imageio_ffmpeg
                    filename=name+".mp4"
                    h,w=frames[0].shape[:2]
                    proc=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),"-v","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{w}x{h}","-r","24","-i","pipe:0","-an","-c:v","libx264","-pix_fmt","yuv420p",str(directory/filename)],input=frames.tobytes(),capture_output=True)
                    if proc.returncode: raise ValueError(proc.stderr.decode(errors="replace"))
            outputs.append({"filename":filename,"subfolder":"refmods/previews","type":"output","kind":mod.kind,"name":mod.name})
        return {"ui":{"studio_refmod":[{"previews":outputs}]},"result":(json.dumps(outputs),)}


NODE_CLASS_MAPPINGS = {c.__name__: c for c in (StudioH3RefModLoad, StudioH3RefModReferenceToVideo, StudioH3RefModImageToVideo, StudioH3RefModBuild, StudioH3RefModPreview)}
NODE_DISPLAY_NAME_MAPPINGS = {name: name for name in NODE_CLASS_MAPPINGS}

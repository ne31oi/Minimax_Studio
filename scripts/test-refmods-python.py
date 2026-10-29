"""CPU integration checks against the real pinned ComfyUI and MiniMaxH3Mod APIs."""
import asyncio
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parent.parent
COMFY = ROOT / "ComfyUI-Easy-Install" / "ComfyUI"
sys.path.insert(0, str(COMFY))
sys.argv = [sys.argv[0], "--cpu"]
import torch
import folder_paths
import server

server.PromptServer(asyncio.new_event_loop())

def load_package(name, file):
    spec = importlib.util.spec_from_file_location(name, file, submodule_search_locations=[str(file.parent)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

up = load_package("studio_test_upstream", COMFY / "custom_nodes" / "ComfyUI-MiniMaxH3Mod" / "__init__.py")
integration = load_package("studio_test_integration", ROOT / "custom nodes" / "minimax_studio_refmods" / "__init__.py")
nodes = sys.modules[integration.__package__ + ".nodes"]
core = sys.modules[up.__package__ + ".core"]
bundle = sys.modules[up.__package__ + ".bundle"]


class FakeClip:
    def __init__(self): self.calls = []
    def tokenize(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return {"tokens": prompt}
    def encode_from_tokens_scheduled(self, tokens):
        return [[torch.zeros(1, 1, 1), {"minimax_token_tags": []}]]


class FakeVAE:
    def encode(self, pixels):
        t = 1 if pixels.shape[0] == 1 else max(1, pixels.shape[0] // 4)
        return torch.zeros(1, 24, t, max(2, pixels.shape[1] // 16), max(2, pixels.shape[2] // 16))
    def decode(self, latent):
        return torch.zeros(1, latent.shape[2], latent.shape[3] * 16, latent.shape[4] * 16, 3)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.clip, self.vae = FakeClip(), FakeVAE()
        self.mod = core.H3RefMod(name="hero", kind="image", latent=torch.zeros(1,24,1,4,4), latent_t=1, latent_h=4, latent_w=4)
        self.settings = json.dumps({"frameCurve":{"direction":"constant","shape":"linear","value":1},"maxTokens":5120})

    def test_real_schema_extends_native(self):
        for cls in (nodes.StudioH3RefModReferenceToVideo, nodes.StudioH3RefModImageToVideo):
            schema = cls.define_schema()
            self.assertTrue(schema.node_id.startswith("StudioH3RefMod"))
            self.assertEqual(len(schema.outputs), 2)
            self.assertTrue(any(i.id == "mods" for i in schema.inputs))

    def test_mixed_refs_one_encode_one_injection(self):
        result = nodes.StudioH3RefModReferenceToVideo.execute(
            clip=self.clip, vae=self.vae, audio_vae=None, prompt="<Picture 2> in the room", width=64, height=64, length=5,
            ref_images={"ref_image_0":torch.zeros(1,64,64,3)},mods=[(self.mod,1)],settings=self.settings)
        self.assertEqual(len(self.clip.calls), 1)
        items = self.clip.calls[0][1]["minimax_ref_items"]
        self.assertEqual([i["type"] for i in items], ["image","image"])
        refs = result.result[0][0][1]["minimax_refs"]
        self.assertEqual(len(refs), 2)
        self.assertEqual(sum(bool(r.get("refmod")) for r in refs), 1)

    def test_frames_preserve_keyframes(self):
        result=nodes.StudioH3RefModImageToVideo.execute(clip=self.clip,vae=self.vae,prompt="turn",width=64,height=64,length=5,first_frame=torch.zeros(1,64,64,3),last_frame=torch.ones(1,64,64,3),mods=[(self.mod,1)],settings=self.settings)
        metadata=result.result[0][0][1]
        self.assertEqual(len(metadata["minimax_keyframes"]),2)
        self.assertEqual(len(metadata["minimax_refs"]),1)
        self.assertEqual(len(self.clip.calls),1)
        self.assertEqual(len(self.clip.calls[0][1]["minimax_ref_items"]),3)

    def test_no_cross_job_reference_leak(self):
        for count in (1,0,1,0):
            result=nodes.StudioH3RefModImageToVideo.execute(clip=self.clip,vae=self.vae,prompt="room",width=64,height=64,length=5,mods=[(self.mod,1)]*count,settings=self.settings)
            self.assertEqual(len(result.result[0][0][1]["minimax_refs"]),count)

    def test_loader_components_copies_and_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            folder_paths.add_model_folder_path("refmods",temp)
            stem=str(Path(temp)/"hero")
            bundle.save_bundle(stem,"hero",[(self.mod,1)])
            spec={"items":[{"entryId":"test","enabled":True,"strength":1,"visualStrength":1,"audioStrength":1,"components":"All","copies":2,"memberIndices":[0]}],"files":{"test":stem+".safetensors"},"versions":{},"maxTokens":5120}
            self.assertEqual(len(nodes.StudioH3RefModLoad().load(json.dumps(spec))[0]),2)
            spec["maxTokens"]=1
            with self.assertRaises(ValueError): nodes.StudioH3RefModLoad().load(json.dumps(spec))
            spec["maxTokens"]=5120;spec["versions"]={"test":"bad-hash"}
            with self.assertRaisesRegex(ValueError,"changed"): nodes.StudioH3RefModLoad().load(json.dumps(spec))
            sidecar=Path(stem+".json");sidecar.write_text("{}")
            digest=hashlib.sha256(Path(stem+".safetensors").read_bytes()+sidecar.read_bytes()).hexdigest()
            spec["versions"]={"test":digest}
            self.assertEqual(len(nodes.StudioH3RefModLoad().load(json.dumps(spec))[0]),2)
            sidecar.write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError,"changed"):nodes.StudioH3RefModLoad().load(json.dumps(spec))

    def test_creator_one_source_per_member_and_budget(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp:
            Image.new("RGB",(128,128),(100,50,25)).save(Path(temp)/"source.png")
            spec={"directory":temp,"name":"test","description":"","mode":"encode","resolution":128,"frameLimit":16,"poolSize":16,"refinementSteps":0,"maxTokens":1,"sources":[{"file":"source.png","kind":"image","name":"source","start":0,"end":None}]}
            with self.assertRaises(ValueError):nodes.StudioH3RefModBuild().build(json.dumps(spec),"test-never-saved",vae=self.vae)

    def test_audio_sources_outside_comfy_input(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/"source.wav"
            with wave.open(str(file), "wb") as out:
                out.setnchannels(2); out.setsampwidth(2); out.setframerate(44100)
                out.writeframes(bytes(44100*4))
            audio=nodes.load_audio(str(file))
            self.assertEqual(audio["sample_rate"],44100)
            self.assertEqual(tuple(audio["waveform"].shape),(1,2,44100))

    def test_dropped_curve_members_do_not_shift_labels(self):
        audio=core.H3RefMod(name="sound",kind="audio",latent=torch.zeros(1,32,2,4),latent_t=4)
        settings=json.dumps({"frameCurve":{"direction":"concept_at_end","shape":"linear","value":0},"maxTokens":5120})
        result=nodes.StudioH3RefModReferenceToVideo.execute(clip=self.clip,vae=self.vae,audio_vae=None,prompt="sound",width=64,height=64,length=5,mods=[(self.mod,1),(audio,1)],settings=settings)
        self.assertEqual(result.ui["studio_refmod_map"][0][0]["name"],"sound")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)

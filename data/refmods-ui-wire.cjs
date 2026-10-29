const fs=require('fs'),ts=require('typescript');
function update(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')))}
function replaceStatement(s,p,name,value){const ast=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let range;function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name))range=[n.getStart(ast),n.end];ts.forEachChild(n,visit)}visit(ast);if(!range)throw new Error('statement '+name);return s.slice(0,range[0])+value+s.slice(range[1]);}
const p='src/components/h3/generate-view.tsx';update(p,s=>{
  s=s.replace("import { useCallback, useEffect, useMemo, useRef, useState } from 'react'", "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\nimport { useRefModMentions } from '@/hooks/use-refmod-mentions'\nimport { selectedRefMods } from '@/lib/refmods/store'\nimport { emptyRefModSet, refModTokens } from '@/lib/refmods/types'");
  const ast=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const ranges=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['refTag','tagsForRefs','rewritePromptTags'].includes(n.name?.text)).map(n=>[n.getStart(ast),n.end]);for(const [a,b]of ranges.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+s.slice(b);
  s=replaceStatement(s,p,'mentions',`const mentions: MentionItem[] = useRefModMentions('generate', video.mode === 'ref' ? video.refs.filter(r => !(video.audioGuide && r.kind === 'audio')).map(r => ({...r, previewUrl: r.previewUrl || '/api/comfy/file?type=input&filename=' + encodeURIComponent(r.path)})) : video.mode === 'flf' ? [video.startFrame, video.endFrame].flatMap((r, i) => r ? [{id: 'frame-' + i, name: r.name, kind: 'image' as const, previewUrl: r.previewUrl}] : []) : [], video.prompt, setPrompt)`);
  s=replaceStatement(s,p,'removeRefSynced','const removeRefSynced = useCallback((id: string) => removeRef(id), [removeRef])');
  s=replaceStatement(s,p,'moveRefSynced','const moveRefSynced = useCallback((from: number, to: number) => moveRef(from, to), [moveRef])');
  s=s.replace('const handleGenerate = useCallback(async () => {','const handleGenerate = useCallback(async (requestMode?: unknown) => {');
  s=s.replace("if (mode !== 'ref') {", "if (mode !== 'ref' && refModTokens(selectedRefMods('generate')) === 0) {");
  s=s.replace('      await generate({\n      modelType:', '      const request: Parameters<typeof generate>[0] = {\n      modelType:');
  const marker="      outputSubfolder: v.outputFolder || '', // (правка 91) папка проекта\n      })";
  if(!s.includes(marker))throw new Error('generate request end');
  s=s.replace(marker,"      outputSubfolder: v.outputFolder || '', // (правка 91) папка проекта\n      }\n      if (requestMode === 'refmods') {\n        const seed = v.seed >= 0 ? v.seed : Math.floor(Math.random() * 2147483647)\n        request.seed = seed\n        const set = selectedRefMods('generate')\n        if (!refModTokens(set)) { toast.error('Выберите RefMods для сравнения'); return }\n        void generate({ ...request, refMods: emptyRefModSet() })\n        void generate({ ...request, refMods: set })\n        toast.success('A/B: две задачи с одним seed поставлены в очередь')\n      } else await generate(request)");
  s=s.replace("  useEffect(() => {\n    if (error) toast.error(error)","  useEffect(() => {\n    const compare = () => void handleGenerate('refmods')\n    window.addEventListener('h3:refmod-compare', compare)\n    return () => window.removeEventListener('h3:refmod-compare', compare)\n  }, [handleGenerate])\n\n  useEffect(() => {\n    if (error) toast.error(error)");
  return s;
});
update('src/components/h3/extend-view.tsx',s=>{
  s=s.replace("import { MentionTextarea, type MentionItem } from './mention-textarea'", "import { MentionTextarea, type MentionItem } from './mention-textarea'\nimport { useRefModMentions } from '@/hooks/use-refmod-mentions'\nimport { remapReferenceTags, type ReferenceLabel } from '@/lib/refmods/types'");
  s=replaceStatement(s,'extend-view.tsx','clipMentions',`const clipMentions: MentionItem[] = useRefModMentions('extend', extendRefs.map(r => ({...r, kind:'image' as const})))
  const previousRefModMentions = useRef<ReferenceLabel[] | null>(null)
  const mentionKey = JSON.stringify(clipMentions)
  useEffect(() => {
    const labels = clipMentions as ReferenceLabel[]
    const before = previousRefModMentions.current
    if (before) {
      const state = useGenStore.getState().video
      const clips = state.extendClips.map(c => ({...c, prompt:remapReferenceTags(c.prompt, before, labels)}))
      if (clips.some((c, i) => c.prompt !== state.extendClips[i].prompt)) patchVideo({extendClips:clips})
    }
    previousRefModMentions.current = labels
  }, [mentionKey, patchVideo])`);return s;
});
update('src/components/h3/controlnet-view.tsx',s=>{
  const importLine=s.split('\n').find(l=>l.includes('MentionTextarea')&&l.startsWith('import '));s=s.replace(importLine,importLine.replace(', type MentionItem','')+"\nimport { useRefModMentions } from '@/hooks/use-refmod-mentions'");
  s=s.replace("  const refImages = useControlNetTarget((s) => s.refImages)","  const refImages = useControlNetTarget((s) => s.refImages)\n  const refModMentions = useRefModMentions('controlnet', refImages.map(r => ({...r, name:r.name,kind:'image' as const})), prompt, setPrompt)");
  s=s.replace(/mentions=\{params\.preprocessOnly \? undefined : refImages\.map\([\s\S]*?\}\)\)\}/,"mentions={params.preprocessOnly ? undefined : refModMentions}");return s;
});
update('src/components/h3/refmods-panel.tsx',s=>s.replace('      <RefModCurveEditor value={set.frameCurve}',`      {target==='generate' && <button className={refModButton} disabled={!active} onClick={()=>window.dispatchEvent(new Event('h3:refmod-compare'))}>A/B: без RefMods / с RefMods</button>}
      <RefModCurveEditor value={set.frameCurve}`));

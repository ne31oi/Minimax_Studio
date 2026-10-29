exports.id=9415,exports.ids=[9415],exports.modules={78335:()=>{},91595:(a,b,c)=>{"use strict";c.d(b,{B8:()=>m,Ib:()=>D,WP:()=>E,bj:()=>l,u:()=>v,uJ:()=>w,xg:()=>k});var d=c(79646),e=c(28354),f=c(29021),g=c(33873),h=c.n(g),i=c(92981);let j=(0,e.promisify)(d.execFile);function k(){return h().join(process.cwd(),"upscale")}function l(){return(0,i.WE)().upscalePort}function m(a="/"){return`http://127.0.0.1:${l()}${a}`}let n=null,o=null,p=null,q=0,r="",s=!1,t=!1,u=()=>{if(n&&n.pid&&null===n.exitCode&&null===n.signalCode)try{n.kill()}catch{}};for(let a of(process.once("exit",u),["SIGINT","SIGTERM"]))process.once(a,()=>{u(),process.exit(130)});function v(){return{running:!!n&&!n.killed&&null===n.exitCode&&null===n.signalCode||s,starting:!!o,error:p,startedAt:q}}async function w(a=3e3){let b=await fetch(m("/health"),{signal:AbortSignal.timeout(a)});if(!b.ok)throw Error(`bridge /health → ${b.status}`);return await b.json()}async function x(a){let b=Date.now()+a;for(;Date.now()<b&&(!n||!n.killed&&null===n.exitCode&&null===n.signalCode)&&!t;){try{if((await fetch(m("/health"),{signal:AbortSignal.timeout(2500)})).ok)return!0}catch{}await new Promise(a=>setTimeout(a,700))}return!1}function y(a){"win32"===process.platform&&a&&j("taskkill",["/F","/T","/PID",String(a)]).catch(()=>{})}function z(a){n===a&&(n=null);try{a.kill()}catch{}}let A=a=>new Promise(b=>setTimeout(b,a));async function B(a){if("win32"!==process.platform)return[];try{let{stdout:b}=await j("netstat",["-ano"]),c=new Set;for(let d of b.split(/\r?\n/)){let b=d.trim().match(/^tcp\s+(\S+):(\d+)\s+(\S+)\s+\S+\s+(\d+)/i);if(b&&Number(b[2])===a&&("*:*"===b[3]||"0.0.0.0:0"===b[3]||"[::]:0"===b[3])){let a=Number(b[4]);Number.isFinite(a)&&a>0&&c.add(a)}}return[...c]}catch{return[]}}async function C(a){for(let b of(await B(a)))y(b)}async function D(a={}){if(a.force&&(t=!1),o)return o;if(t&&!a.force)return{ok:!1,error:"Сервис остановлен пользователем — нажмите \xabЗапустить\xbb"};if(n&&!n.killed&&null===n.exitCode&&null===n.signalCode){if(await x(8e3))return p=null,{ok:!0};y(n.pid),z(n)}if(s){try{if(await w(2500))return p=null,{ok:!0}}catch{}s=!1}return o=(async()=>{let a=null;try{let b=(0,i.WE)();if(!b.upscaleEnabled)return{ok:!1,error:"Вкладка Upscale отключена: config.ini → [upscale] enabled=1"};let c=k(),e=h().join(c,"bin","python-3.13.15-embed-amd64","python.exe"),g=h().join(c,"bridge.py");if(!(0,f.existsSync)(e)){let a="Не найден встроенный рантайм Upscale (upscale/bin/…). Папка upscale/ должна лежать рядом с start.bat.";return p=a,{ok:!1,error:a}}if(!(0,f.existsSync)(g)){let a=`Не найден входной файл: ${g}`;return p=a,{ok:!1,error:a}}r="";let j=l();try{if(await w(2500))return s=!0,q=Date.now(),p=null,{ok:!0}}catch{}try{await C(j),await A(600)}catch{}try{(0,f.mkdirSync)(b.outputDir,{recursive:!0})}catch{}let m={...process.env,PYTHONNOUSERSITE:"1",PYTHONDONTWRITEBYTECODE:"1",PYTHONIOENCODING:"utf-8",UPSCALE_BRIDGE_PORT:String(j),UPSCALE_OUTPUT_DIR:b.outputDir};if(n=a=(0,d.spawn)(e,[g],{cwd:c,env:m,stdio:["ignore","pipe","pipe"],windowsHide:!0}),q=Date.now(),a.stdout?.on("data",a=>{for(let b of a.toString("utf8").split(/\r?\n/))b&&(b.includes("GET /health")&&/\s200\b/.test(b)||process.stdout.write(`[upscale] ${b}
`))}),a.stderr?.on("data",a=>{r=(r+a.toString("utf8")).slice(-8e3),process.stderr.write(`[upscale] ${a}`)}),a.on("exit",()=>{n===a&&(n=null)}),t)return y(a.pid),z(a),{ok:!1,error:"Остановлено пользователем"};if(!await x(18e4)){if(t)return y(a.pid),z(a),{ok:!1,error:"Остановлено пользователем"};let b=r.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0,400),c=`Upscale не запустился: порт ${j} занят или процесс завершился. ${b?`Лог: ${b}`:"См. консоль"}`;return p=c,n===a&&(y(a.pid),z(a)),{ok:!1,error:c}}return p=null,{ok:!0}}catch(c){a&&n===a&&(y(a.pid),z(a));let b=c instanceof Error?c.message:String(c);return p=b,{ok:!1,error:b}}finally{o=null}})()}async function E(){if(s){let a=l();s=!1,t=!0;try{await C(a),await A(300)}catch{}p=null;return}let a=n;if(!a){n=null,t=!0;return}t=!0,y(a.pid),await F(a,6e3)||(z(a),await F(a,4e3)),n===a&&(n=null),p=null}function F(a,b){return null!==a.exitCode||null!==a.signalCode?Promise.resolve(!0):new Promise(c=>{let d=setTimeout(()=>c(!1),b);a.once("exit",()=>{clearTimeout(d),c(!0)})})}},92981:(a,b,c)=>{"use strict";c.d(b,{Dd:()=>l,WE:()=>i,yJ:()=>j});var d=c(29021),e=c(33873);let f=(0,e.join)(process.cwd(),"config","config.ini");function g(a,b){if(void 0===a||""===a.trim())return b;let c=parseFloat(a);return Number.isFinite(c)?c:b}let h=null;function i(){let a=0;try{a=(0,d.statSync)(f).mtimeMs}catch{}if(h&&h.mtimeMs===a)return h.config;let b={};try{(0,d.existsSync)(f)&&(b=function(a){let b={},c="";for(let d of a.split("\n")){let a=d.trim();if(!a||a.startsWith("#")||a.startsWith(";"))continue;if(a.startsWith("[")&&a.endsWith("]")){c=a.slice(1,-1);continue}let e=a.indexOf("=");if(e>0){let d=a.slice(0,e).trim(),f=a.slice(e+1).trim();b[`${c}.${d}`]=f,("reserve_gb"===d||"dynamic_vram"===d)&&(b[d]=f)}}return b}((0,d.readFileSync)(f,"utf-8")))}catch{}let c=(b["comfy.comfy_dir"]??"").trim()||(process.env.COMFY_ROOT||"").trim()||(0,e.join)(process.cwd(),"ComfyUI-Easy-Install"),i=(0,e.resolve)(c),j=Math.max(4096,Math.min(102400,parseInt(b["llm.context_size"]??"25600",10)||25600)),k={reserveGb:g(b["vram.reserve_gb"]??b.reserve_gb??"3",3),vramHeadroom:Math.max(0,Math.min(8,parseFloat(b["vram.vram_headroom"]??"2")||0)),dynamicVram:(b["vram.dynamic_vram"]??b["comfy.dynamic_vram"]??b.dynamic_vram??"1")!=="0",llmDevice:["auto","gpu","cpu"].includes(b["llm.device"]??"")?b["llm.device"]:"auto",llmContextSize:j,llmMaxOutputTokens:Math.max(256,Math.min(j,16384,parseInt(b["llm.max_output_tokens"]??"4096",10)||4096)),comfyRoot:i,outputDir:(0,e.join)(i,"ComfyUI","output"),inputDir:(0,e.join)(i,"ComfyUI","input"),pythonExe:(0,e.join)(i,"python_embeded","python.exe"),diffusionModel:(b["comfy.diffusion_model"]??"").trim(),llmModel:(b["llm.model"]??"").trim(),llmBonsaiDir:(b["llm.bonsai_dir"]??"").trim()||(0,e.join)(process.cwd(),"Bonsai_2_27B"),llmCustomModel:(b["llm.custom_model_path"]??"").trim(),llmCustomMmproj:(b["llm.custom_mmproj_path"]??"").trim(),modelExtraPaths:function(a){let b=a.trim();if(!b)return[];try{let a=JSON.parse(b);if(!Array.isArray(a))return[];return a.filter(a=>!!a&&"object"==typeof a&&"string"==typeof a.path&&"string"==typeof a.category).map(a=>({path:a.path,category:a.category}))}catch{return[]}}(b["models.extra_paths"]??""),llmVideoVision:"0"!==b["llm.video_vision"],llmKvCache:["off","q8_0","q5_1","q4_0"].includes(b["llm.kv_cache"]??"")?b["llm.kv_cache"]:"q4_0",llmSamplingOverride:"1"===b["llm.sampling_override"],llmTemperature:g(b["llm.temperature"],.7),llmTopP:g(b["llm.top_p"],.95),llmTopK:Math.max(1,Math.min(200,parseInt(b["llm.top_k"]??"40",10)||40)),llmMinP:Math.max(0,Math.min(1,g(b["llm.min_p"],.05))),llmPresencePenalty:Math.max(0,Math.min(2.5,parseFloat(b["llm.presence_penalty"]??"0.0")||0)),llmFrequencyPenalty:Math.max(0,Math.min(2.5,parseFloat(b["llm.frequency_penalty"]??"0.0")||0)),llmRepeatPenalty:Math.max(1,Math.min(2,parseFloat(b["llm.repeat_penalty"]??"1.0")||1)),soundOn:"0"!==b["ui.sound_on"],sttEnabled:"0"!==b["stt.enabled"],sttDir:(b["stt.dir"]??"").trim()||(0,e.join)(process.cwd(),"stt"),sttModel:(b["stt.model"]??"").trim(),sttLanguage:["auto","ru","en"].includes(b["stt.language"]??"")?b["stt.language"]:"ru",sttThreads:Math.max(0,Math.min(32,parseInt(b["stt.threads"]??"0",10)||0)),upscaleEnabled:"0"!==b["upscale.enabled"],upscalePort:Math.max(1024,Math.min(65535,parseInt(b["upscale.port"]??"7890",10)||7890)),videoCodec:["h264","h265","nvenc_h264","nvenc_h265"].includes(b["video.codec"]??"")?b["video.codec"]:"h264",videoCrf:Math.max(0,Math.min(30,g(b["video.crf"],12))),videoNvencBitrate:Math.max(4,Math.min(40,parseInt(b["video.nvenc_bitrate"]??"16",10)||16))};return h={mtimeMs:a,config:k},k}function j(a,b,c){let e="";try{e=(0,d.readFileSync)(f,"utf-8")}catch{e=""}let g=c.replace(/[\r\n\0]/g," ").trim(),i=e.split(/\r?\n/),j=!1,k=-1,l=!1,m=-1;for(let c=0;c<i.length;c++){let d=i[c].trim();if(d.startsWith("[")&&d.endsWith("]")){if(j)break;(j=d.slice(1,-1)===a)&&(k=c);continue}if(j){let a=d.indexOf("=");if(a>0&&d.slice(0,a).trim().toLowerCase()===b.toLowerCase()){i[c]=`${b}=${g}`,l=!0;break}m=c+1}}l||(k>=0?i.splice(Math.max(m,k+1),0,`${b}=${g}`):i.push("",`[${a}]`,`${b}=${g}`));let n=f+".tmp";(0,d.writeFileSync)(n,i.join("\n"),"utf-8");try{(0,d.renameSync)(n,f)}catch{try{(0,d.rmSync)(f,{force:!0})}catch{}(0,d.renameSync)(n,f)}h=null}let k=`[vram]
reserve_gb=3
dynamic_vram=1
; 0 = синхронная загрузка моделей (стабильно), 1 = async-офлоад
async_offload=0
vram_headroom=2

[comfy]
turbo_lora=
; Пусто = дефолтная diffusion-модель из кода
diffusion_model=
; comfy_dir не задан = ./ComfyUI-Easy-Install рядом с программой

[llm]
custom_mmproj_path=
custom_model_path=
repeat_penalty=1
frequency_penalty=0
presence_penalty=0
min_p=0.05
top_k=40
top_p=0.95
temperature=0.7
sampling_override=0
kv_cache=q4_0
video_vision=1
model=Qwen3.5-9B-Q4_K_M.gguf
max_output_tokens=4096
context_size=25600
device=auto

[ui]
sound_on=1

[stt]
dir=
threads=0
language=ru
model=
enabled=1

[upscale]
enabled=1
port=7890

[models]
extra_paths=[]

[video]
codec=h264
crf=12
nvenc_bitrate=16
`;function l(){(0,d.mkdirSync)((0,e.dirname)(f),{recursive:!0});let a=f+".tmp";(0,d.writeFileSync)(a,k,"utf-8");try{(0,d.renameSync)(a,f)}catch{try{(0,d.rmSync)(f,{force:!0})}catch{}(0,d.renameSync)(a,f)}h=null}},96487:()=>{}};
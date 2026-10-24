import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleAlert, CloudUpload, Code2, FileCode2, FileText, Folder, Github, LoaderCircle, LockKeyhole, Plus, Rocket, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'

const API = ''
async function request(path, options = {}) {
  const res = await fetch(API + path, { credentials: 'include', ...options })
  const type = res.headers.get('content-type') || ''
  const body = type.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) throw new Error(body?.detail || body?.message || `Request failed (${res.status})`)
  return body
}
const prettyBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`

export default function App() {
  const [topic, setTopic] = useState('Explainable Deep Learning Framework for Early Detection of Crop Diseases Using Multispectral Imagery')
  const [language, setLanguage] = useState('React + FastAPI + Python ML')
  const [uploads, setUploads] = useState([])
  const [requirements, setRequirements] = useState('')
  const [project, setProject] = useState(null)
  const [files, setFiles] = useState([])
  const [activeFile, setActiveFile] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [gh, setGh] = useState({ connected: false })
  const [repos, setRepos] = useState([])
  const [mode, setMode] = useState('create')
  const [repoName, setRepoName] = useState('crop-disease-explainable-ai')
  const [owner, setOwner] = useState('')
  const [description, setDescription] = useState('Explainable deep learning for early crop disease detection using multispectral imagery.')
  const [branch, setBranch] = useState('main')
  const [privateRepo, setPrivateRepo] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const [step, setStep] = useState(1)

  useEffect(() => {
    request('/api/github/status').then(setGh).catch(() => {})
    if (new URLSearchParams(location.search).get('github') === 'connected') {
      setNotice('GitHub connected successfully.')
      history.replaceState({}, '', location.pathname)
      request('/api/github/repositories').then(r => { setGh({ connected: true, login: r.user.login }); setRepos(r.repositories); setOwner(r.user.login) }).catch(e => setError(e.message))
    }
  }, [])

  async function onFilesChange(e) {
    const selected = Array.from(e.target.files || [])
    setUploads(selected)
    if (!selected.length) return
    const form = new FormData()
    form.append('topic', topic)
    form.append('language', language)
    selected.forEach(f => form.append('files', f))
    try {
      const data = await request('/api/projects/analyze', { method: 'POST', body: form })
      setRequirements(data.requirements)
      setNotice(`Extracted text from ${data.uploaded_files} uploaded file(s).`)
      setError('')
    } catch (e2) { setError(e2.message) }
  }

  async function generate() {
    if (!topic.trim() && !requirements.trim()) { setError('Enter a project topic or upload a specification first.'); return }
    setGenerating(true); setError(''); setNotice(''); setProject(null); setFiles([]); setFileContent(''); setPublishResult(null); setStep(2)
    try {
      const data = await request('/api/projects/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, language, requirements }) })
      setProject(data); setFiles(data.files); setActiveFile(data.files[0]?.path || ''); setStep(3)
      if (data.files[0]) await preview(data.project_id, data.files[0].path)
      setNotice(`Generated ${data.files.length} files successfully.`)
    } catch (e) { setError(e.message); setStep(1) }
    finally { setGenerating(false) }
  }

  async function preview(projectId, path) {
    setActiveFile(path); setLoadingFile(true)
    try { const data = await request(`/api/projects/${projectId}/files/${path.split('/').map(encodeURIComponent).join('/')}`); setFileContent(data.content) }
    catch (e) { setError(e.message) }
    finally { setLoadingFile(false) }
  }

  async function connectGitHub() {
    try { const res = await fetch('/api/github/login', { credentials: 'include', redirect: 'manual' }); if (res.status === 0 || res.type === 'opaqueredirect') location.href = '/api/github/login'; else if (res.redirected) location.href = res.url; else { const b = await res.json(); throw new Error(b.detail || 'Unable to start GitHub authorization.') } }
    catch (e) { setError(e.message) }
  }

  async function loadRepos() {
    try { const data = await request('/api/github/repositories'); setGh({ connected: true, login: data.user.login }); setRepos(data.repositories); setOwner(data.user.login); setNotice(`Loaded repositories for ${data.user.login}.`) }
    catch (e) { setError(e.message) }
  }

  async function publish() {
    if (!project) return
    if (!confirm) { setError('Confirm that you reviewed the files before publishing.'); return }
    setPublishing(true); setError(''); setNotice(''); setPublishResult(null)
    try {
      const data = await request('/api/github/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: project.project_id, mode, repo_name: repoName, owner: owner || undefined, description, private: privateRepo, branch, confirm }) })
      setPublishResult(data); setNotice(`Published ${data.files_published} files to GitHub.`)
    } catch (e) { setError(e.message) }
    finally { setPublishing(false) }
  }

  const grouped = useMemo(() => {
    const tree = {}
    files.forEach(f => { const parts = f.path.split('/'); const dir = parts.slice(0,-1).join('/') || 'root'; (tree[dir] ||= []).push(f) })
    return tree
  }, [files])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>AI Project Builder</b><small>BUILD • EXPLAIN • SHIP</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className="nav-item active"><Code2 size={17}/> Project Studio <span className="nav-dot"/></button>
      <button className="nav-item" onClick={() => document.getElementById('files-panel')?.scrollIntoView({behavior:'smooth'})}><Folder size={17}/> Generated files</button>
      <button className="nav-item" onClick={() => document.getElementById('publish-panel')?.scrollIntoView({behavior:'smooth'})}><Github size={17}/> GitHub publishing</button>
      <div className="sidebar-bottom"><div className="secure-mini"><ShieldCheck size={17}/><div><b>Private by design</b><small>Keys stay on the backend</small></div></div><div className="version">AI PROJECT BUILDER <span>v1.0</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <ChevronRight size={14}/> <b>Project Studio</b></div><div className="top-actions"><span className="status-pill"><span/> API workspace</span><button className="avatar">{gh.login ? gh.login.slice(0,1).toUpperCase() : 'A'}</button></div></header>
      <div className="content">
        <section className="hero"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR IDEA, ENGINEERED</div><h1>Turn your idea into<br/><span>a complete codebase.</span></h1><p>Describe your project. Generate the files. Preview every line. Download it or publish straight to GitHub.</p></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-icon"><Code2 size={42}/></div><div className="float-card float-a"><Sparkles size={14}/> AI generated</div><div className="float-card float-b"><Check size={14}/> Ready to ship</div></div></section>
        <section className="steps">
          {[['01','Describe','Topic & files'],['02','Generate','AI builds code'],['03','Review','Preview & test'],['04','Publish','ZIP or GitHub']].map(([n,t,s],i)=><div className={`step ${step===i+1?'current':step>i+1?'done':''}`} key={n}><div className="step-number">{step>i+1?<Check size={14}/>:n}</div><div><b>{t}</b><small>{s}</small></div>{i<3&&<div className="step-connector"/>}</div>)}
        </section>
        {(error || notice) && <div className={`alert ${error?'alert-error':'alert-success'}`} role="status">{error?<CircleAlert size={17}/>:<Check size={17}/>}<span>{error || notice}</span><button onClick={()=>{setError('');setNotice('')}} aria-label="Dismiss"><X size={15}/></button></div>}
        <section className="workspace-grid">
          <div className="panel input-panel"><div className="panel-heading"><div className="heading-icon purple"><Sparkles size={18}/></div><div><h2>Project specification</h2><p>Start with a topic or upload your project brief.</p></div><span className="required">REQUIRED</span></div>
            <label className="field-label" htmlFor="topic">Project topic / requirements</label><textarea id="topic" className="topic-input" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Describe what you want to build..." rows={5}/>
            <div className="field-row"><label className="field-label" htmlFor="language">Preferred stack</label><span className="optional">Choose a starting point</span></div>
            <select id="language" value={language} onChange={e=>setLanguage(e.target.value)} className="select-input"><option>React + FastAPI + Python ML</option><option>React + FastAPI</option><option>Python + Flask</option><option>Python machine learning</option><option>Node.js + React</option><option>Java + Spring Boot</option><option>HTML + CSS + JavaScript</option><option>Custom / follow topic</option></select>
            <label className="upload-zone"><input type="file" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,.bmp" onChange={onFilesChange}/><div className="upload-icon"><CloudUpload size={23}/></div><div><b>Drop your project files here</b><p>PDF, DOCX, TXT or images · up to 10 MB each</p></div><span className="browse-btn"><Upload size={14}/> Browse files</span></label>
            {uploads.length>0&&<div className="upload-list">{uploads.map(f=><div key={f.name}><FileText size={15}/><span>{f.name}</span><small>{prettyBytes(f.size)}</small></div>)}</div>}
            {requirements && <details className="extracted"><summary>Extracted specification text</summary><pre>{requirements}</pre></details>}
            <button className="primary-btn generate-btn" onClick={generate} disabled={generating}><span>{generating?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>}</span>{generating?'Generating project…':'Generate project'}<ArrowUpRight size={17}/></button>
            <p className="hint"><LockKeyhole size={13}/> Your AI key is never sent to the browser.</p>
          </div>
          <div className="right-stack">
            <div className="panel overview-panel"><div className="panel-heading"><div className="heading-icon blue"><Activity size={18}/></div><div><h2>Build overview</h2><p>Your project at a glance</p></div></div>
              <div className="overview-stats"><div><span>FILES GENERATED</span><b>{files.length.toString().padStart(2,'0')}</b><small>{project?'Files ready':'Waiting for generation'}</small></div><div><span>PROJECT STATUS</span><b className="status-text">{project?'Ready':'Draft'}</b><small>{project?'Review your code':'Describe to get started'}</small></div></div>
              <div className="progress-head"><span>Workflow progress</span><b>{project?'75%':generating?'35%':'10%'}</b></div><div className="progress-track"><div style={{width:project?'75%':generating?'35%':'10%'}}/></div>
              <div className="check-row"><span className={project?'check-circle passed':'check-circle'}>{project?<Check size={12}/>:<span/>}</span><span>Specification received</span><small>STEP 01</small></div><div className="check-row"><span className={project?'check-circle passed':'check-circle'}>{project?<Check size={12}/>:<span/>}</span><span>Source files generated</span><small>STEP 02</small></div><div className="check-row"><span className="check-circle"><span/></span><span>Review and publish</span><small>STEP 03</small></div>
            </div>
            <div className="panel quick-panel"><div className="panel-heading"><div className="heading-icon green"><ArrowDownToLine size={18}/></div><div><h2>Export your project</h2><p>Take your code wherever you need it.</p></div></div><div className="export-row"><div className="export-file"><FileCode2 size={20}/></div><div className="export-info"><b>Source code bundle</b><small>ZIP archive · folder structure preserved</small></div><button className="icon-btn" disabled={!project} onClick={()=>window.location.href=`/api/projects/${project.project_id}/download`} title="Download ZIP"><ArrowDownToLine size={17}/></button></div><button className="secondary-btn" disabled={!project} onClick={()=>window.location.href=`/api/projects/${project.project_id}/download`}>Download project ZIP <ArrowDownToLine size={16}/></button></div>
          </div>
        </section>
        <section className="panel files-panel" id="files-panel"><div className="panel-heading"><div className="heading-icon blue"><Folder size={18}/></div><div><h2>Generated source files</h2><p>{project?`${project.project_name} · ${files.length} files`:'Your generated folder structure will appear here.'}</p></div><span className="file-count">{files.length} FILES</span></div>
          {!project ? <div className="empty-state"><div><Folder size={25}/></div><b>Your codebase will live here</b><p>Generate your project to explore the file tree and inspect source code.</p></div> :
          <div className="file-workspace"><div className="file-tree"><div className="tree-title"><Folder size={14}/> {project.project_name}</div>{Object.entries(grouped).map(([dir,items])=><div key={dir} className="tree-group">{dir!=='root'&&<div className="tree-dir"><Folder size={14}/>{dir}</div>}{items.map(f=><button key={f.path} className={`tree-file ${activeFile===f.path?'selected':''}`} onClick={()=>preview(project.project_id,f.path)}><FileCode2 size={14}/><span>{f.path.split('/').at(-1)}</span><small>{prettyBytes(f.size)}</small></button>)}</div>)}</div>
            <div className="code-view"><div className="code-toolbar"><div><span className="code-live-dot"/><b>{activeFile || 'Select a file'}</b></div><div className="code-tools"><span>{loadingFile?'Loading…':'SOURCE PREVIEW'}</span><button onClick={()=>navigator.clipboard?.writeText(fileContent)} disabled={!fileContent} title="Copy file contents">Copy code</button></div></div><pre className="code-content"><code>{loadingFile?'Loading file…':fileContent || 'Select a file from the explorer to preview its contents.'}</code></pre></div></div>}
        </section>
        <section className="panel publish-panel" id="publish-panel"><div className="panel-heading"><div className="heading-icon dark"><Github size={18}/></div><div><h2>Publish to GitHub</h2><p>Authorize your account, review the destination, and publish the generated code.</p></div><span className={`github-badge ${gh.connected?'connected':''}`}><span/>{gh.connected?'CONNECTED':'NOT CONNECTED'}</span></div>
          {!gh.connected ? <div className="github-connect"><div className="github-big"><Github size={29}/></div><div className="github-copy"><b>Your code, in your repository</b><p>Connect securely with GitHub OAuth. We never ask for your password or a personal access token.</p></div><button className="github-btn" onClick={connectGitHub}><Github size={16}/> Connect GitHub <ArrowUpRight size={15}/></button></div> :
          <><div className="connected-user"><div className="user-check"><Check size={15}/></div><div><b>Connected as @{gh.login}</b><small>OAuth session active in this browser.</small></div><button className="text-btn" onClick={loadRepos}>Refresh repositories</button><button className="text-btn" onClick={()=>request('/api/github/logout',{method:'POST'}).then(()=>{setGh({connected:false});setRepos([]);setNotice('GitHub disconnected.')}).catch(e=>setError(e.message))}>Disconnect</button></div>
            <div className="publish-form"><div className="mode-toggle"><button className={mode==='create'?'chosen':''} onClick={()=>setMode('create')}><Plus size={15}/> Create new repository</button><button className={mode==='existing'?'chosen':''} onClick={()=>setMode('existing')}><Folder size={15}/> Existing repository</button></div>
              {mode==='existing'&&<><label className="field-label">Repository</label><select className="select-input" value={repoName} onChange={e=>{setRepoName(e.target.value.split('/').at(-1));setOwner(e.target.value.split('/')[0]);const r=repos.find(x=>x.full_name===e.target.value);if(r)setBranch(r.default_branch)}}><option value="">Select repository…</option>{repos.map(r=><option key={r.full_name} value={r.full_name}>{r.full_name}{r.private?' · private':''}</option>)}</select><label className="field-label">Repository owner</label><input className="text-input" value={owner} onChange={e=>setOwner(e.target.value)} placeholder="GitHub username or organization"/></>}
              <div className="form-two"><div><label className="field-label">Repository name</label><input className="text-input" value={repoName} onChange={e=>setRepoName(e.target.value)} placeholder="my-project"/></div><div><label className="field-label">Target branch</label><input className="text-input" value={branch} onChange={e=>setBranch(e.target.value)} placeholder="main"/></div></div>
              <label className="field-label">Description</label><input className="text-input" value={description} onChange={e=>setDescription(e.target.value)} maxLength={350}/>
              {mode==='create'&&<label className="private-toggle"><input type="checkbox" checked={privateRepo} onChange={e=>setPrivateRepo(e.target.checked)}/><span><b>Private repository</b><small>Only people with access can view your source code.</small></span><LockKeyhole size={17}/></label>}
              <label className="confirm-row"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/><span>I reviewed the file list and confirm that these files should be published to GitHub.</span></label>
              <div className="publish-actions"><span><ShieldCheck size={15}/> Credentials and .env files are blocked</span><button className="primary-btn" disabled={!project||!confirm||publishing||!repoName.trim()} onClick={publish}>{publishing?<><LoaderCircle className="spin" size={16}/> Publishing…</>:<><Rocket size={16}/> Publish to GitHub</>}</button></div>
            </div></>}
          {publishResult&&<div className="publish-success"><div><Check size={18}/></div><section><b>Project published successfully</b><p>{publishResult.files_published} files committed to <b>{publishResult.branch}</b>.</p><a href={publishResult.repository_url} target="_blank" rel="noreferrer">{publishResult.repository_url} <ArrowUpRight size={14}/></a><small>Commit: {publishResult.commit}</small></section></div>}
        </section>
        <footer><span>AI PROJECT BUILDER</span><span>Generate responsibly. Review before you ship.</span><span><ShieldCheck size={13}/> Secure-by-default workflow</span></footer>
      </div>
    </main>
  </div>
}

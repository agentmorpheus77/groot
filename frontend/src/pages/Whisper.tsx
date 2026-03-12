import { useEffect, useState, useRef } from "react"
import {
  Mic, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp,
  Wand2, BookOpen, Tag, Database, Search, PlayCircle
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

const API = "/api/whisper"

// ── Types ──────────────────────────────────────────────────────────────────

interface Vocabulary {
  id: number
  name: string
  description: string
  language: string
  terms: string[]
  term_count: number
  created_at: string
  updated_at: string
}

interface WhisperDataset {
  id: number
  name: string
  vocabulary_id?: number
  audio_count: number
  total_duration_sec: number
  language: string
  vocabulary_count: number
  created_at: string
}

interface WhisperJob {
  id: number
  name: string
  base_model: string
  status: string
  max_steps: number
  final_wer?: number
  error_message?: string
  created_at: string
  started_at?: string
  finished_at?: string
}

interface BaseModel {
  id: string
  name: string
  size: string
  wer: string
  speed: string
}

const STATUS_COLORS: Record<string, string> = {
  queued:    "bg-slate-500/15 text-slate-400 border-slate-500/30",
  running:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed:    "bg-red-500/15 text-red-400 border-red-500/30",
}

function dur(s?: number) {
  if (!s) return "–"
  return s < 60 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)}min`
}

// ── Vocabulary Editor Component ────────────────────────────────────────────

function VocabularyCard({ vocab, onUpdated, onDeleted }: {
  vocab: Vocabulary
  onUpdated: (v: Vocabulary) => void
  onDeleted: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editName, setEditName] = useState(false)
  const [nameVal, setNameVal] = useState(vocab.name)
  const [descVal, setDescVal] = useState(vocab.description)
  const [newTerm, setNewTerm] = useState("")
  const [search, setSearch] = useState("")
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const terms = vocab.terms || []
  const filtered = search ? terms.filter(t => t.toLowerCase().includes(search.toLowerCase())) : terms

  const saveName = async () => {
    await fetch(`${API}/vocabularies/${vocab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameVal, description: descVal }),
    })
    setEditName(false)
    onUpdated({ ...vocab, name: nameVal, description: descVal })
  }

  const addTerm = async (term: string) => {
    const t = term.trim()
    if (!t || terms.includes(t)) return
    const r = await fetch(`${API}/vocabularies/${vocab.id}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: t }),
    })
    const d = await r.json()
    onUpdated({ ...vocab, terms: d.terms, term_count: d.term_count })
    setNewTerm("")
    inputRef.current?.focus()
  }

  const removeTerm = async (term: string) => {
    const r = await fetch(`${API}/vocabularies/${vocab.id}/terms`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term }),
    })
    const d = await r.json()
    onUpdated({ ...vocab, terms: d.terms, term_count: d.term_count })
  }

  const bulkAdd = async () => {
    setSaving(true)
    const newTerms = [...new Set([
      ...terms,
      ...bulkText.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean)
    ])]
    const r = await fetch(`${API}/vocabularies/${vocab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: newTerms }),
    })
    const d = await r.json()
    onUpdated({ ...vocab, terms: newTerms, term_count: newTerms.length })
    setBulkText("")
    setBulkOpen(false)
    setSaving(false)
  }

  const deleteVocab = async () => {
    if (!confirm(`Vocabulary "${vocab.name}" wirklich löschen?`)) return
    await fetch(`${API}/vocabularies/${vocab.id}`, { method: "DELETE" })
    onDeleted(vocab.id)
  }

  return (
    <Card className="glass-card border-white/8">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 shrink-0">
          <BookOpen className="w-4 h-4 text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          {editName ? (
            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
              <Input
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                className="h-7 text-sm"
                onKeyDown={e => e.key === "Enter" && saveName()}
                autoFocus
              />
              <button onClick={saveName} className="text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setEditName(false); setNameVal(vocab.name) }} className="text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{vocab.name}</span>
              <button
                onClick={e => { e.stopPropagation(); setEditName(true) }}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="text-xs text-muted-foreground">{vocab.description || "Kein Beschreibung"}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs text-rose-400 border-rose-500/30">
            {vocab.term_count} Begriffe
          </Badge>
          <Badge variant="outline" className="text-xs">{vocab.language.toUpperCase()}</Badge>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {/* Beschreibung editieren */}
          <div>
            <Label className="text-xs text-muted-foreground">Beschreibung</Label>
            <Input
              value={descVal}
              onChange={e => setDescVal(e.target.value)}
              onBlur={() => descVal !== vocab.description && fetch(`${API}/vocabularies/${vocab.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: descVal }),
              }).then(() => onUpdated({ ...vocab, description: descVal }))}
              className="mt-1 h-8 text-sm"
              placeholder="Für welchen Anwendungsfall ist dieses Vokabular?"
            />
          </div>

          {/* Suche + Bulk-Add */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Suche in ${terms.length} Begriffen...`}
                className="h-8 pl-7 text-sm"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setBulkOpen(true)}>
              <Plus className="w-3 h-3" /> Bulk
            </Button>
          </div>

          {/* Term hinzufügen */}
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={newTerm}
              onChange={e => setNewTerm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTerm(newTerm)}
              placeholder="Begriff eingeben + Enter..."
              className="h-8 text-sm"
            />
            <Button size="sm" className="h-8 gap-1 shrink-0" onClick={() => addTerm(newTerm)}>
              <Plus className="w-3 h-3" /> Hinzufügen
            </Button>
          </div>

          {/* Terms als Chips */}
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                {search ? `Keine Begriffe für "${search}"` : "Noch keine Begriffe"}
              </p>
            )}
            {filtered.map(term => (
              <span
                key={term}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300 group"
              >
                {term}
                <button
                  onClick={() => removeTerm(term)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          {search && (
            <p className="text-xs text-muted-foreground">{filtered.length} von {terms.length} Begriffen</p>
          )}

          {/* Footer Actions */}
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={deleteVocab}>
              <Trash2 className="w-3 h-3 mr-1" /> Vocabulary löschen
            </Button>
          </div>
        </div>
      )}

      {/* Bulk-Add Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>📋 Bulk-Import — {vocab.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Begriffe einfügen — durch Zeilenumbruch, Komma oder Semikolon getrennt. Duplikate werden ignoriert.
            </p>
            <Textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder={"C 2210\nC 2213\nDosierventil, Dosierpumpe\nVakuumregler; ChlorStop"}
              rows={8}
              className="text-xs font-mono"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {bulkText.split(/[\n,;]+/).filter(t => t.trim()).length} Begriffe erkannt
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Abbrechen</Button>
            <Button onClick={bulkAdd} disabled={saving || !bulkText.trim()}>
              {saving ? "Füge hinzu..." : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function Whisper() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<"vocab" | "datasets" | "training">("vocab")
  const [vocabularies, setVocabularies] = useState<Vocabulary[]>([])
  const [datasets, setDatasets] = useState<WhisperDataset[]>([])
  const [jobs, setJobs] = useState<WhisperJob[]>([])
  const [baseModels, setBaseModels] = useState<BaseModel[]>([])
  const [showNewVocab, setShowNewVocab] = useState(false)
  const [showNewDataset, setShowNewDataset] = useState(false)
  const [showNewJob, setShowNewJob] = useState(false)
  const [saving, setSaving] = useState(false)

  const [vocabForm, setVocabForm] = useState({ name: "", description: "", language: "de" })
  const [datasetForm, setDatasetForm] = useState({ name: "", vocabulary_id: "", tts_voice: "rruSEtlKAwIe1cvEmP9J" })
  const [jobForm, setJobForm] = useState({
    name: "", base_model: "openai/whisper-small", dataset_id: "",
    max_steps: 1000, learning_rate: 0.0001, batch_size: 4,
  })

  const load = async () => {
    const [v, d, j, m] = await Promise.all([
      fetch(`${API}/vocabularies`).then(r => r.json()),
      fetch(`${API}/datasets`).then(r => r.json()),
      fetch(`${API}/jobs`).then(r => r.json()),
      fetch(`${API}/base-models`).then(r => r.json()),
    ])
    setVocabularies(v)
    setDatasets(d)
    setJobs(j)
    setBaseModels(m)
  }

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i) }, [])

  const createVocab = async () => {
    if (!vocabForm.name) return
    setSaving(true)
    await fetch(`${API}/vocabularies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vocabForm),
    })
    setSaving(false)
    setShowNewVocab(false)
    setVocabForm({ name: "", description: "", language: "de" })
    load()
  }

  const generateDataset = async () => {
    if (!datasetForm.vocabulary_id || !datasetForm.name) return
    setSaving(true)
    await fetch(`${API}/datasets/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...datasetForm, vocabulary_id: parseInt(datasetForm.vocabulary_id) }),
    })
    setSaving(false)
    setShowNewDataset(false)
    load()
  }

  const startJob = async () => {
    if (!jobForm.dataset_id || !jobForm.name) return
    setSaving(true)
    await fetch(`${API}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...jobForm, dataset_id: parseInt(jobForm.dataset_id) }),
    })
    setSaving(false)
    setShowNewJob(false)
    load()
  }

  const jobDur = (j: WhisperJob) => {
    if (!j.started_at || !j.finished_at) return "–"
    return dur((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <Mic className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">🎙️ Whisper Fine-Tuning</h1>
            <p className="text-sm text-muted-foreground">Sprachmodell auf Fachvokabular trainieren</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Vocabulary-Sets", value: vocabularies.length, color: "text-rose-400" },
          { label: "Audio-Datasets", value: datasets.length, color: "text-amber-400" },
          { label: "Trainierte Modelle", value: jobs.filter(j => j.status === "completed").length, color: "text-emerald-400" },
        ].map(s => (
          <Card key={s.label} className="glass-card">
            <CardContent className="p-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-lg w-fit">
        {([
          ["vocab", "📚 Vokabular"],
          ["datasets", "🗂️ Datasets"],
          ["training", "⚡ Training"],
        ] as [string, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? "bg-rose-500/20 text-rose-300" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Vokabular ── */}
      {tab === "vocab" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Erstelle separate Vocabulary-Sets für jede Domäne (Lutz-Jesco, CDBrain, Medizin, etc.)
            </p>
            <Button size="sm" onClick={() => setShowNewVocab(true)} className="gap-1.5 shrink-0">
              <Plus className="w-4 h-4" /> Neues Set
            </Button>
          </div>

          {vocabularies.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-12 text-center">
                <BookOpen className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Noch keine Vocabulary-Sets</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {vocabularies.map(v => (
                <VocabularyCard
                  key={v.id}
                  vocab={v}
                  onUpdated={updated => setVocabularies(vs => vs.map(x => x.id === updated.id ? updated : x))}
                  onDeleted={id => setVocabularies(vs => vs.filter(x => x.id !== id))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Datasets ── */}
      {tab === "datasets" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Audio-Clips via ElevenLabs TTS generieren (Chris' Stimme V 0.5)
            </p>
            <Button size="sm" onClick={() => setShowNewDataset(true)} className="gap-1.5 shrink-0"
              disabled={vocabularies.length === 0}>
              <Wand2 className="w-4 h-4" /> Generieren
            </Button>
          </div>

          {vocabularies.length === 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
              ⚠️ Erst ein Vocabulary-Set erstellen, dann kannst du ein Dataset generieren.
            </div>
          )}

          {datasets.length === 0 ? (
            <Card className="glass-card"><CardContent className="py-12 text-center">
              <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Noch keine Datasets</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {datasets.map(d => {
                const vocabName = vocabularies.find(v => v.id === d.vocabulary_id)?.name
                return (
                  <Card key={d.id} className="glass-card">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{d.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {d.audio_count} Clips · {dur(d.total_duration_sec)}
                            {vocabName && <> · <span className="text-rose-400">{vocabName}</span></>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{d.language.toUpperCase()}</Badge>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                      onClick={() => navigate(`/whisper/review/${d.id}`)}>
                      <PlayCircle className="w-3.5 h-3.5" /> Review
                    </Button>
                  </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Training ── */}
      {tab === "training" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Whisper auf ein Audio-Dataset fine-tunen</p>
            <Button size="sm" onClick={() => setShowNewJob(true)} className="gap-1.5 shrink-0"
              disabled={datasets.length === 0}>
              <Plus className="w-4 h-4" /> Training starten
            </Button>
          </div>

          {jobs.length === 0 ? (
            <Card className="glass-card"><CardContent className="py-12 text-center">
              <Mic className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Noch keine Training-Jobs</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => (
                <Card key={job.id} className="glass-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[job.status] ?? ""}`}>
                            {job.status}
                          </span>
                          {job.final_wer != null && (
                            <span className={`text-xs font-mono font-bold ${job.final_wer < 5 ? "text-emerald-400" : job.final_wer < 10 ? "text-amber-400" : "text-red-400"}`}>
                              WER: {job.final_wer.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium truncate">{job.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {job.base_model.split("/").pop()} · {job.max_steps} Steps · {jobDur(job)}
                        </div>
                        {job.error_message && (
                          <div className="text-xs text-red-400 mt-1 font-mono">{job.error_message.slice(0, 100)}</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Dialog: Neues Vocabulary-Set ── */}
      <Dialog open={showNewVocab} onOpenChange={setShowNewVocab}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>📚 Neues Vocabulary-Set</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input value={vocabForm.name} onChange={e => setVocabForm(f => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Lutz-Jesco Fachvokabular" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Beschreibung</Label>
              <Input value={vocabForm.description} onChange={e => setVocabForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Für welche Domäne / welches Modell?" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sprache</Label>
              <Select value={vocabForm.language} onValueChange={v => setVocabForm(f => ({ ...f, language: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">🇩🇪 Deutsch</SelectItem>
                  <SelectItem value="en">🇬🇧 English</SelectItem>
                  <SelectItem value="fr">🇫🇷 Français</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Nach dem Erstellen kannst du Begriffe einzeln oder per Bulk-Import hinzufügen.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewVocab(false)}>Abbrechen</Button>
            <Button onClick={createVocab} disabled={saving || !vocabForm.name}>
              {saving ? "Erstelle..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Dataset generieren ── */}
      <Dialog open={showNewDataset} onOpenChange={setShowNewDataset}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>🎙️ Audio-Dataset generieren</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input value={datasetForm.name} onChange={e => setDatasetForm(f => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Lutz-Jesco DE v1" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vocabulary-Set *</Label>
              <Select value={datasetForm.vocabulary_id} onValueChange={v => setDatasetForm(f => ({ ...f, vocabulary_id: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Vocabulary wählen..." /></SelectTrigger>
                <SelectContent>
                  {vocabularies.map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.name} ({v.term_count} Begriffe)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
              🎙️ Generiert Audio-Clips mit <strong>Chris V 0.5</strong> (ElevenLabs). Jeder Begriff wird in 3 Satz-Varianten gesprochen.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDataset(false)}>Abbrechen</Button>
            <Button onClick={generateDataset} disabled={saving || !datasetForm.vocabulary_id || !datasetForm.name}>
              {saving ? "Starte..." : "Generieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Training starten ── */}
      <Dialog open={showNewJob} onOpenChange={setShowNewJob}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>⚡ Whisper Training starten</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))}
                placeholder="z.B. LUTZ Whisper Small v1" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Base Model</Label>
              <Select value={jobForm.base_model} onValueChange={v => setJobForm(f => ({ ...f, base_model: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {baseModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} · {m.wer} WER · {m.size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Audio-Dataset *</Label>
              <Select value={jobForm.dataset_id} onValueChange={v => setJobForm(f => ({ ...f, dataset_id: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Dataset wählen..." /></SelectTrigger>
                <SelectContent>
                  {datasets.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name} ({d.audio_count} Clips)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Max Steps</Label>
                <Input type="number" value={jobForm.max_steps}
                  onChange={e => setJobForm(f => ({ ...f, max_steps: +e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Learning Rate</Label>
                <Input type="number" step="0.00001" value={jobForm.learning_rate}
                  onChange={e => setJobForm(f => ({ ...f, learning_rate: +e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewJob(false)}>Abbrechen</Button>
            <Button onClick={startJob} disabled={saving || !jobForm.dataset_id || !jobForm.name}>
              {saving ? "Startet..." : "Training starten"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

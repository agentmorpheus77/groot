import { useEffect, useState } from "react"
import { BookOpen, Plus, Trash2, ExternalLink, ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const API = "/api/learnings"

interface Learning {
  id: number
  title: string
  content: string
  source: string
  model?: string
  job_id?: number
  tags?: string
  url?: string
  created_at: string
}

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  research: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  training: "bg-amber-500/15 text-amber-400 border-amber-500/30",
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  research: "Research",
  training: "Training",
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `vor ${mins} Min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `vor ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `vor ${days}d`
}

function LearningCard({ learning, onDelete }: { learning: Learning; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const tags = learning.tags ? learning.tags.split(",").map(t => t.trim()).filter(Boolean) : []
  const preview = learning.content.slice(0, 220)
  const hasMore = learning.content.length > 220

  return (
    <Card className="glass-card group transition-all duration-200 hover:border-white/10">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Title + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${SOURCE_COLORS[learning.source] ?? SOURCE_COLORS.manual}`}>
                {SOURCE_LABELS[learning.source] ?? learning.source}
              </span>
              {learning.model && (
                <span className="text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                  {learning.model}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {formatRelativeDate(learning.created_at)}
              </span>
            </div>

            <h3 className="font-semibold text-sm mb-2 leading-snug">{learning.title}</h3>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.map(tag => (
                  <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0 h-5 text-muted-foreground">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Content */}
            <div className="text-xs text-muted-foreground leading-relaxed">
              <pre className="whitespace-pre-wrap font-sans">
                {expanded ? learning.content : preview}
                {!expanded && hasMore && "..."}
              </pre>
            </div>

            {/* Toggle + URL */}
            <div className="flex items-center gap-3 mt-2">
              {hasMore && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  {expanded ? <><ChevronUp className="w-3 h-3" /> Weniger</> : <><ChevronDown className="w-3 h-3" /> Mehr anzeigen</>}
                </button>
              )}
              {learning.url && (
                <a
                  href={learning.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Quelle
                </a>
              )}
            </div>
          </div>

          {/* Delete */}
          <button
            onClick={() => {
              if (window.confirm(`"${learning.title}" wirklich löschen?`)) onDelete()
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

const EMPTY_FORM = { title: "", content: "", source: "manual", model: "", tags: "", url: "" }

export default function Learnings() {
  const [learnings, setLearnings] = useState<Learning[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState("all")
  const [tagFilter, setTagFilter] = useState("")
  const [search, setSearch] = useState("")
  const [showDialog, setShowDialog] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const params = new URLSearchParams()
    if (sourceFilter !== "all") params.set("source", sourceFilter)
    if (tagFilter) params.set("tag", tagFilter)
    if (search) params.set("q", search)
    const res = await fetch(`${API}?${params}`)
    setLearnings(await res.json())
  }

  const loadTags = async () => {
    const res = await fetch(`${API}/tags`)
    setAllTags(await res.json())
  }

  useEffect(() => { load(); loadTags() }, [sourceFilter, tagFilter, search])

  const handleDelete = async (id: number) => {
    await fetch(`${API}/${id}`, { method: "DELETE" })
    load(); loadTags()
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        content: form.content,
        source: form.source,
        model: form.model || null,
        tags: form.tags || null,
        url: form.url || null,
      }),
    })
    setSaving(false)
    setShowDialog(false)
    setForm(EMPTY_FORM)
    load(); loadTags()
  }

  const SOURCES = ["all", "manual", "research", "training"]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <BookOpen className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">📚 Learnings</h1>
            <p className="text-sm text-muted-foreground">{learnings.length} Erkenntnisse protokolliert</p>
          </div>
        </div>
        <Button onClick={() => setShowDialog(true)} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> Neues Learning
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Source tabs */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          {SOURCES.map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
                sourceFilter === s
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "Alle" : SOURCE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen..."
            className="pl-8 h-8 text-xs"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                tagFilter === tag
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Learning Cards */}
      {learnings.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Keine Learnings gefunden</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowDialog(true)}>
              <Plus className="w-4 h-4 mr-1" /> Erstes Learning anlegen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {learnings.map(l => (
            <LearningCard key={l.id} learning={l} onDelete={() => handleDelete(l.id)} />
          ))}
        </div>
      )}

      {/* New Learning Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>📚 Neues Learning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Titel *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="z.B. Chat Template Mismatch Bug"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Inhalt *</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Problem, Ursache, Fix, nächstes Mal besser..."
                rows={5}
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Quelle</Label>
                <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Modell (optional)</Label>
                <Input
                  value={form.model}
                  onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="Qwen3-4B"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tags (kommagetrennt)</Label>
              <Input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="template,bug,fix,dataset"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">URL / Quelle (optional)</Label>
              <Input
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving || !form.title || !form.content}>
              {saving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

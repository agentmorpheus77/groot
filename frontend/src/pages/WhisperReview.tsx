import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  Play, Pause, Check, X, RefreshCw, Mic, MicOff,
  ChevronLeft, ChevronRight, Filter, SkipForward,
  Volume2, Upload, ArrowLeft
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"

const API = "/api/whisper"

const VOICES = [
  { id: "rruSEtlKAwIe1cvEmP9J", name: "Chris V 0.5 (Original)" },
  { id: "oWJ0GSUjVyxG4cvdzY5t", name: "Peter Hartlapp (Werbesprecher)" },
  { id: "aTTiK3YzK3dXETpuDE2h", name: "Ben (Conversational)" },
  { id: "z1EhmmPwF0ENGYE8dBE6", name: "Christian Plasa" },
  { id: "vmVmHDKBkkCgbLVIOJRb", name: "Charlie Chatlin" },
  { id: "FTNCalFNG5bRnkkaP5Ug", name: "Otto" },
]

interface Clip {
  id: number
  dataset_id: number
  clip_index: number
  term: string
  sentence: string
  status: "pending" | "approved" | "rejected"
  voice_id: string
  regenerated_at?: string
}

interface Stats {
  total: number
  approved: number
  rejected: number
  pending: number
  progress: number
}

// ── Mini Audio Player ──────────────────────────────────────────────────────

function AudioPlayer({ clipId, datasetId, cacheKey = 0, overrideSrc, baseVersion }: {
  clipId: number
  datasetId: number
  cacheKey?: number
  overrideSrc?: string | null  // Blob-URL nach Aufnahme — überschreibt Server-Src
  baseVersion?: string | null  // regenerated_at — überlebt Page-Reload als Cache-Buster
}) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  // baseVersion = regenerated_at vom Server → ändert sich bei jedem Upload/Regen → überlebt Reload
  // cacheKey = lokaler Zähler → sofortige Aktualisierung innerhalb der Session
  const versionStr = baseVersion ? `${baseVersion}_${cacheKey}` : String(cacheKey)
  const serverSrc = `${API}/datasets/${datasetId}/clips/${clipId}/audio?v=${versionStr}`
  const src = overrideSrc || serverSrc

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause() } else { a.play().catch(() => {}) }
  }

  return (
    <div className="flex items-center gap-2">
      <audio key={src} ref={audioRef} src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={() => {
          const a = audioRef.current
          if (a?.duration) setProgress((a.currentTime / a.duration) * 100)
        }}
        preload="none"
      />
      <button onClick={toggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
          playing
            ? "bg-rose-500/30 text-rose-300 hover:bg-rose-500/40"
            : overrideSrc
              ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 ring-1 ring-rose-500/40"
              : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden cursor-pointer"
        onClick={(e) => {
          const a = audioRef.current
          if (!a?.duration) return
          const rect = e.currentTarget.getBoundingClientRect()
          a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
        }}
      >
        <div className={`h-full rounded-full transition-all duration-100 ${overrideSrc ? "bg-rose-400" : "bg-white/40"}`}
          style={{ width: `${progress}%` }} />
      </div>
      {overrideSrc && (
        <span className="text-xs text-rose-400 shrink-0">🎙️</span>
      )}
    </div>
  )
}

// ── Recorder ──────────────────────────────────────────────────────────────

type RecordState = "idle" | "recording" | "uploading"

function RecordButton({ clipId, datasetId, onPreview, onSaved, onCancel }: {
  clipId: number
  datasetId: number
  onPreview: (blobUrl: string | null) => void  // Blob-URL hoch → Haupt-Player zeigt sie
  onSaved: (savedAt: string) => void           // Nach erfolgreichem Upload (timestamp)
  onCancel: () => void                          // Verwerfen
}) {
  const [state, setState] = useState<RecordState>("idle")
  const [blob, setBlob] = useState<Blob | null>(null)
  const [seconds, setSeconds] = useState(0)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "audio/webm" })
        const url = URL.createObjectURL(b)
        setBlob(b)
        onPreview(url)          // → Haupt-Player zeigt sofort meine Aufnahme
        setState("idle")
        if (timerRef.current) clearInterval(timerRef.current)
      }
      mr.start(100)
      mediaRef.current = mr
      setSeconds(0)
      setState("recording")
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch {
      alert("Kein Mikrofon-Zugriff. Bitte Berechtigung erlauben.")
    }
  }

  const stopRec = () => {
    mediaRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const upload = async () => {
    if (!blob) return
    setState("uploading")
    const form = new FormData()
    form.append("file", blob, "recording.webm")
    const res = await fetch(`${API}/datasets/${datasetId}/clips/${clipId}/upload`, {
      method: "POST", body: form,
    })
    const data = await res.json().catch(() => ({}))
    setBlob(null)   // Blob löschen → zeigt wieder 🎙️ Button
    setState("idle")
    onSaved(data.saved_at || new Date().toISOString())
  }

  if (state === "recording") return (
    <button onClick={stopRec}
      className="flex items-center gap-1.5 px-2 h-8 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-colors"
      title="Aufnahme stoppen">
      <span className="w-2 h-2 rounded-sm bg-red-400 animate-pulse shrink-0" />
      <span className="text-xs font-mono">{seconds}s</span>
    </button>
  )

  if (state === "uploading") return (
    <div className="flex items-center gap-1 px-2 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
      <Upload className="w-3 h-3 animate-pulse" /> ...
    </div>
  )

  // Wenn blob da: Upload-Button + Verwerfen anbieten (neben dem Haupt-Player)
  if (blob) return (
    <div className="flex gap-1">
      <button onClick={upload}
        className="px-2 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium flex items-center gap-1">
        <Check className="w-3 h-3" /> Speichern
      </button>
      <button onClick={() => { setBlob(null); onCancel() }}
        className="w-8 h-8 rounded-lg bg-white/5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 border border-white/10 flex items-center justify-center transition-colors"
        title="Verwerfen">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )

  return (
    <button onClick={startRec}
      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
      title="Selbst einsprechen">
      <Mic className="w-3.5 h-3.5" />
    </button>
  )
}

// ── Clip Card ─────────────────────────────────────────────────────────────

function ClipCard({ clip, datasetId, selected, onSelect, onStatusChange, onRegenerate }: {
  clip: Clip
  datasetId: number
  selected: boolean
  onSelect: (id: number, sel: boolean) => void
  onStatusChange: (id: number, status: string) => void
  onRegenerate: (id: number, voiceId?: string) => void
}) {
  const [regenVoice, setRegenVoice] = useState(clip.voice_id || VOICES[0].id)
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cacheKey, setCacheKey] = useState(0)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Picker schließen bei Klick außerhalb
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowVoicePicker(false)
      }
    }
    if (showVoicePicker) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showVoicePicker])

  const setStatus = async (status: string) => {
    await fetch(`${API}/datasets/${datasetId}/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    // Jetzt erst Blob freigeben & Server-Audio laden (WAV ist persistiert)
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl)
      setPreviewBlobUrl(null)
      setCacheKey(k => k + 1)
    }
    onStatusChange(clip.id, status)
  }

  const regen = async (voiceId: string) => {
    setBusy(true)
    setShowVoicePicker(false)
    await fetch(`${API}/datasets/${datasetId}/clips/${clip.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: voiceId }),
    })
    setRegenVoice(voiceId)
    setCacheKey(k => k + 1)
    setBusy(false)
    onRegenerate(clip.id, voiceId)  // → Parent updated voice_id im State
  }

  const statusColors = {
    approved: "border-emerald-500/40 bg-emerald-500/5",
    rejected: "border-red-500/30 bg-red-500/5",
    pending:  "border-white/8 bg-white/2",
  }

  // Voice-Name: zeige aktuell verwendete Stimme (nach Regen aktualisiert)
  const displayVoiceId = regenVoice || clip.voice_id
  const currentVoiceName = displayVoiceId === "user_recording"
    ? "🎙️ Eigene"
    : (VOICES.find(v => v.id === displayVoiceId)?.name?.split(" ")[0] || "?")

  return (
    <Card className={`glass-card transition-all ${statusColors[clip.status]} ${selected ? "ring-2 ring-rose-500/50" : ""}`}>
      <CardContent className="p-3">
        {/* Header: Checkbox + Term + Status */}
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={e => onSelect(clip.id, e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer shrink-0"
          />
          <span className="font-mono text-sm font-bold text-rose-300 flex-1 truncate">{clip.term}</span>
          <span className="text-xs text-muted-foreground/50">#{clip.clip_index + 1}</span>
          {clip.status === "approved" && <span className="text-xs text-emerald-400 font-bold">✓</span>}
          {clip.status === "rejected" && <span className="text-xs text-red-400 font-bold">✗</span>}
        </div>

        {/* Satz */}
        <p className="text-xs text-muted-foreground mb-3 italic pl-5">"{clip.sentence}"</p>

        {/* Player — zeigt entweder eigene Aufnahme (Blob) oder Server-Audio */}
        <div className="mb-3 pl-5">
          <AudioPlayer
            clipId={clip.id}
            datasetId={datasetId}
            cacheKey={cacheKey}
            overrideSrc={previewBlobUrl}
            baseVersion={clip.regenerated_at}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 pl-5">
          {/* Approve */}
          <button onClick={() => setStatus("approved")}
            className={`flex-1 h-7 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
              clip.status === "approved"
                ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
                : "bg-white/5 text-muted-foreground hover:bg-emerald-500/20 hover:text-emerald-300 border border-white/10"
            }`}>
            <Check className="w-3 h-3" /> OK
          </button>

          {/* Reject */}
          <button onClick={() => setStatus("rejected")}
            className={`flex-1 h-7 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
              clip.status === "rejected"
                ? "bg-red-500/30 text-red-300 border border-red-500/40"
                : "bg-white/5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 border border-white/10"
            }`}>
            <X className="w-3 h-3" /> Nein
          </button>

          {/* Regen Button + Voice Picker */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowVoicePicker(!showVoicePicker)}
              disabled={busy}
              className={`h-7 px-2 rounded-lg flex items-center gap-1 text-xs transition-colors border disabled:opacity-50 ${
                showVoicePicker
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-white/5 text-muted-foreground hover:bg-amber-500/20 hover:text-amber-300 border-white/10"
              }`}
              title="Stimme wählen & neu generieren"
            >
              <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{busy ? "..." : currentVoiceName}</span>
            </button>

            {showVoicePicker && (
              <div className="absolute bottom-9 right-0 z-50 bg-[#0d1117] border border-white/15 rounded-xl shadow-2xl p-2 w-64">
                <p className="text-xs text-muted-foreground px-2 py-1.5 border-b border-white/10 mb-1">
                  Stimme wählen → dann Generieren klicken
                </p>
                {VOICES.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setRegenVoice(v.id)}
                    className={`w-full text-left text-xs px-2 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      regenVoice === v.id
                        ? "bg-rose-500/15 text-rose-300"
                        : "hover:bg-white/8 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full border shrink-0 flex items-center justify-center ${
                      regenVoice === v.id ? "border-rose-400 bg-rose-400" : "border-white/30"
                    }`}>
                      {regenVoice === v.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    {v.name}
                  </button>
                ))}
                <div className="border-t border-white/10 mt-1 pt-1">
                  <button
                    onClick={() => regen(regenVoice)}
                    className="w-full h-8 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Jetzt generieren
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Record */}
          <RecordButton
            clipId={clip.id}
            datasetId={datasetId}
            onPreview={(url) => {
              setPreviewBlobUrl(url)        // Haupt-Player zeigt sofort meine Aufnahme
              setRegenVoice("user_recording")
            }}
            onSaved={(savedAt) => {
              // Blob-URL BLEIBT — Player zeigt weiter meine Aufnahme bis OK/Nein klicken
              // baseVersion im Parent updaten → nach Reload kommt sofort meine Aufnahme
              setRegenVoice("user_recording")
              onRegenerate(clip.id, "user_recording")  // updated regenerated_at im Clips-Array
            }}
            onCancel={() => {
              if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl)
              setPreviewBlobUrl(null)       // Verwerfen → zurück zu altem Audio
              setRegenVoice(clip.voice_id || VOICES[0].id)
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main Review Page ───────────────────────────────────────────────────────

export default function WhisperReview() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const dsId = parseInt(datasetId || "0")

  const [clips, setClips] = useState<Clip[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, approved: 0, rejected: 0, pending: 0, progress: 0 })
  const [filter, setFilter] = useState<string>("all")
  const [autoPlay, setAutoPlay] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkVoice, setBulkVoice] = useState(VOICES[1].id)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkPicker, setShowBulkPicker] = useState(false)

  const loadClips = useCallback(async () => {
    const r = await fetch(`${API}/datasets/${dsId}/clips`)
    const d = await r.json()
    setClips(d.clips || [])
    setStats(d.stats || {})
  }, [dsId])

  useEffect(() => { loadClips() }, [loadClips])

  const filtered = filter === "all" ? clips : clips.filter(c => c.status === filter)

  const toggleSelect = (id: number, sel: boolean) => {
    setSelected(s => { const n = new Set(s); sel ? n.add(id) : n.delete(id); return n })
  }
  const selectAll = () => setSelected(new Set(filtered.map(c => c.id)))
  const selectNone = () => setSelected(new Set())

  const bulkRegenerate = async () => {
    if (selected.size === 0) return
    setBulkBusy(true)
    setShowBulkPicker(false)
    const ids = [...selected]
    for (const id of ids) {
      await fetch(`${API}/datasets/${dsId}/clips/${id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: bulkVoice }),
      })
      setClips(cs => cs.map(c => c.id === id ? { ...c, status: "pending" } : c))
    }
    setSelected(new Set())
    setBulkBusy(false)
    loadClips()
  }

  const bulkApprove = async () => {
    if (selected.size === 0) return
    await Promise.all([...selected].map(id =>
      fetch(`${API}/datasets/${dsId}/clips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      })
    ))
    setClips(cs => cs.map(c => selected.has(c.id) ? { ...c, status: "approved" } : c))
    setSelected(new Set())
    loadClips()
  }

  const handleStatus = (id: number, status: string) => {
    setClips(cs => cs.map(c => c.id === id ? { ...c, status: status as any } : c))
    setStats(s => {
      const old = clips.find(c => c.id === id)?.status || "pending"
      const n = { ...s }
      if (old !== status) {
        n[old as keyof Stats] = Math.max(0, (n[old as keyof Stats] as number) - 1)
        n[status as keyof Stats] = (n[status as keyof Stats] as number || 0) + 1
        n.progress = Math.round(n.approved / n.total * 100)
      }
      return n
    })
    // Auto-advance: nächsten pending anzeigen
    if (autoPlay && status !== "pending") {
      setTimeout(() => setCurrentIdx(i => Math.min(i + 1, filtered.length - 1)), 300)
    }
  }

  const approveAll = async () => {
    await Promise.all(
      clips.filter(c => c.status === "pending").map(c =>
        fetch(`${API}/datasets/${dsId}/clips/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        })
      )
    )
    loadClips()
  }

  const pendingCount = stats.pending || 0
  const approvedCount = stats.approved || 0
  const total = stats.total || 0

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/whisper")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            🎙️ Audio Review
            <span className="text-sm font-normal text-muted-foreground">Dataset #{dsId}</span>
          </h1>
          <p className="text-xs text-muted-foreground">Jeden Clip anhören — OK ✓ | Ablehnen ✗ | Neu generieren 🔄 | Selbst einsprechen 🎙️</p>
        </div>
      </div>

      {/* Progress Bar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-400 font-medium">✓ {approvedCount} OK</span>
              <span className="text-amber-400 font-medium">◎ {pendingCount} offen</span>
              <span className="text-red-400 font-medium">✗ {stats.rejected || 0} abgelehnt</span>
            </div>
            <span className="text-sm font-bold">{stats.progress || 0}%</span>
          </div>
          <Progress value={stats.progress || 0} className="h-2" />
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={() => setAutoPlay(!autoPlay)}
            >
              {autoPlay ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              Auto-Play {autoPlay ? "an" : "aus"}
            </Button>
            {pendingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-7 text-emerald-400 hover:text-emerald-300"
                onClick={approveAll}
              >
                <Check className="w-3 h-3" /> Alle pending freigeben
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk-Aktionsleiste — erscheint wenn etwas ausgewählt ist */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-40 flex items-center gap-2 p-3 bg-rose-950/90 border border-rose-500/30 rounded-xl backdrop-blur-sm shadow-lg">
          <span className="text-sm font-medium text-rose-300 mr-1">{selected.size} ausgewählt</span>

          {/* Bulk Approve */}
          <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
            onClick={bulkApprove}>
            <Check className="w-3 h-3" /> Alle freigeben
          </Button>

          {/* Bulk Regen mit Voice-Picker */}
          <div className="relative">
            <Button size="sm" disabled={bulkBusy}
              className="h-7 text-xs gap-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30"
              onClick={() => setShowBulkPicker(!showBulkPicker)}>
              <RefreshCw className={`w-3 h-3 ${bulkBusy ? "animate-spin" : ""}`} />
              {bulkBusy ? `Generiere...` : `Neu generieren (${VOICES.find(v => v.id === bulkVoice)?.name?.split(" ")[0]})`}
            </Button>
            {showBulkPicker && (
              <div className="absolute top-9 left-0 z-50 bg-[#0d1117] border border-white/15 rounded-xl shadow-2xl p-2 w-64">
                <p className="text-xs text-muted-foreground px-2 py-1.5 border-b border-white/10 mb-1">
                  Stimme für alle {selected.size} Clips:
                </p>
                {VOICES.map(v => (
                  <button key={v.id} onClick={() => setBulkVoice(v.id)}
                    className={`w-full text-left text-xs px-2 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      bulkVoice === v.id ? "bg-rose-500/15 text-rose-300" : "hover:bg-white/8 text-muted-foreground"
                    }`}>
                    <span className={`w-3 h-3 rounded-full border shrink-0 flex items-center justify-center ${
                      bulkVoice === v.id ? "border-rose-400 bg-rose-400" : "border-white/30"
                    }`}>
                      {bulkVoice === v.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    {v.name}
                  </button>
                ))}
                <div className="border-t border-white/10 mt-1 pt-1">
                  <button onClick={bulkRegenerate}
                    className="w-full h-8 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium flex items-center justify-center gap-1.5">
                    <RefreshCw className="w-3 h-3" /> {selected.size} Clips generieren
                  </button>
                </div>
              </div>
            )}
          </div>

          <button onClick={selectNone} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          ["all", `Alle (${total})`],
          ["pending", `Offen (${pendingCount})`],
          ["approved", `Freigegeben (${approvedCount})`],
          ["rejected", `Abgelehnt (${stats.rejected || 0})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === key
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                : "bg-white/5 text-muted-foreground hover:bg-white/10 border border-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Alle auswählen */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={e => e.target.checked ? selectAll() : selectNone()}
            className="w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer"
          />
          <span>Alle auswählen ({filtered.length})</span>
          {selected.size > 0 && <span className="text-rose-400">• {selected.size} markiert</span>}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card className="glass-card"><CardContent className="py-12 text-center text-muted-foreground text-sm">
          Keine Clips in dieser Kategorie
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((clip, i) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              datasetId={dsId}
              selected={selected.has(clip.id)}
              onSelect={toggleSelect}
              onStatusChange={handleStatus}
              onRegenerate={(id, voiceId) => {
                setClips(cs => cs.map(c =>
                  c.id === id
                    ? { ...c, status: "pending", voice_id: voiceId || c.voice_id, regenerated_at: new Date().toISOString() }
                    : c
                ))
              }}
            />
          ))}
        </div>
      )}

      {/* Footer CTA */}
      {approvedCount > 0 && (
        <Card className="glass-card border-emerald-500/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-400">{approvedCount} Clips freigegeben</p>
              <p className="text-xs text-muted-foreground">Bereit für Whisper Fine-Tuning</p>
            </div>
            <Button
              size="sm"
              className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 gap-1.5"
              onClick={() => navigate("/whisper?tab=training")}
            >
              Training starten →
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

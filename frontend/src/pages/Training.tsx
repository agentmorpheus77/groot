import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Zap, Play, Trash2, FileText, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listDatasets, listJobs, createJob, deleteJob, type Dataset, type Job } from "@/api"
import { formatDate, formatDuration, formatLoss } from "@/lib/utils"
import { cn } from "@/lib/utils"

type BaseModel = { id: string; name: string; size?: string; recommended_for?: string }
type LogLine = { type: string; msg: string }

export default function Training() {
  const { t } = useTranslation()
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [baseModels, setBaseModels] = useState<BaseModel[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [logsJobId, setLogsJobId] = useState<number | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const [form, setForm] = useState({
    name: "",
    dataset_id: "",
    base_model: "",
    epochs: 5,
    learning_rate: 0.00005,
    max_seq_length: 1024,
    batch_size: 4,
    iters: 20000,
  })

  const load = () => {
    listDatasets().then(r => setDatasets(r.data)).catch(console.error)
    listJobs().then(r => setJobs(r.data)).catch(console.error)
    fetch("/api/jobs/models").then(r => r.json()).then(d => {
      const models: BaseModel[] = d.models || []
      setBaseModels(models)
      if (models.length > 0) setForm(p => ({ ...p, base_model: p.base_model || models[0].id }))
    }).catch(console.error)
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000) // Poll every 5s
    return () => clearInterval(timer)
  }, [])

  // Auto-open logs for any running job on page load
  useEffect(() => {
    if (jobs.length > 0 && logsJobId === null) {
      const running = jobs.find(j => j.status === "running")
      if (running) openLogs(running.id)
    }
  }, [jobs])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const handleSubmit = async () => {
    if (!form.name || !form.dataset_id || !form.base_model) return
    setSubmitting(true)
    try {
      const job = await createJob({
        name: form.name,
        dataset_id: parseInt(form.dataset_id),
        base_model: form.base_model,
        epochs: form.epochs,
        learning_rate: form.learning_rate,
        max_seq_length: form.max_seq_length,
        batch_size: form.batch_size,
        iters: form.iters,
      })
      setShowForm(false)
      load()
      // Auto-open logs for new job
      openLogs(job.data.id)
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  const openLogs = (jobId: number) => {
    // Close existing
    eventSourceRef.current?.close()
    setLogs([])
    setLogsJobId(jobId)

    const es = new EventSource(`/api/jobs/${jobId}/logs`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type !== "ping") {
        setLogs(prev => [...prev, data])
      }
      if (data.msg === "__STREAM_END__") {
        es.close()
        load()
      }
    }
    // Polling fallback (works via Cloudflare tunnel where SSE may break)
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}/log-snapshot`)
        if (!r.ok) return
        const lines: string[] = await r.json()
        if (lines.length > 0) setLogs(lines.map(l => ({ type: "log", msg: l })))
      } catch {}
    }

    const startPolling = () => {
      if (pollInterval) return
      poll() // sofort beim Start
      pollInterval = setInterval(async () => {
        try {
          const r2 = await fetch(`/api/jobs/${jobId}/status`)
          if (!r2.ok) return
          const s = await r2.json()
          if (s.status !== "running") {
            clearInterval(pollInterval!)
            pollInterval = null
            load()
            return
          }
          poll()
        } catch {}
      }, 2000) // alle 2 Sekunden
    }

    es.onerror = () => {
      es.close()
      startPolling()
    }

    // SSE Timeout-Schutz: wenn nach 10s keine Nachricht → Polling starten
    const sseTimeout = setTimeout(() => {
      if (pollInterval === null) startPolling()
    }, 10000)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteJob(deleteTarget.id).catch(console.error)
    load()
    setDeleteTarget(null)
  }

  const resumeJob = async (jobId: number) => {
    try {
      await fetch(`/api/jobs/${jobId}/resume`, { method: "POST" })
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const statusVariant = (s: string) =>
    s === "completed" ? "success" : s === "running" ? "running" : s === "failed" ? "failed" : "queued"

  const logColor = (type: string) => {
    if (type === "error") return "text-red-400"
    if (type === "success") return "text-emerald-400"
    if (type === "info") return "text-blue-400"
    if (type === "cmd") return "text-primary/80"
    return "text-foreground/70"
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("training.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("training.subtitle")}</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={datasets.length === 0}>
          <Play className="w-4 h-4 mr-2" />
          {t("training.newJob")}
        </Button>
      </div>

      {datasets.length === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          ⚠️ {t("training.noDatasets")}
        </div>
      )}

      {/* New Job Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              {t("training.newJob")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("training.form.jobName")}</Label>
              <Input
                placeholder={t("training.form.jobNamePlaceholder")}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("training.form.dataset")}</Label>
              <Select value={form.dataset_id} onValueChange={v => setForm(p => ({ ...p, dataset_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t("training.form.datasetSelect")} />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map(ds => (
                    <SelectItem key={ds.id} value={String(ds.id)}>
                      {ds.name} ({ds.row_count} {t("common.rows")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("training.form.baseModel")}</Label>
              <Select value={form.base_model} onValueChange={v => setForm(p => ({ ...p, base_model: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {baseModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-medium">{m.name}</span>
                      {m.size && <span className="text-muted-foreground ml-2 text-xs">{m.size}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>{t("training.form.iterations")}</Label>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded cursor-help"
                    title="Wie oft das Modell trainiert wird. Faustregel: (Anzahl Trainingspaare × Epochen) / Batch Size. Für Fakten-Training: mind. 3 Epochen. Beispiel: 15.000 Paare × 5 / 4 = ~19.000 Iterationen.">
                    ?
                  </span>
                </div>
                <Input type="number" min={10} max={50000} value={form.iters}
                  onChange={e => setForm(p => ({ ...p, iters: parseInt(e.target.value) || 100 }))} />
                <p className="text-[10px] text-muted-foreground">
                  Style: 500–2.000 · Fakten: 10.000–20.000
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>{t("training.form.batchSize")}</Label>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded cursor-help"
                    title="Anzahl Beispiele pro Trainingsschritt. Größerer Batch = schneller aber mehr RAM. Empfehlung: 4 (sicher) oder 8 (bei 32GB+ RAM).">
                    ?
                  </span>
                </div>
                <Input type="number" min={1} max={16} value={form.batch_size}
                  onChange={e => setForm(p => ({ ...p, batch_size: parseInt(e.target.value) || 4 }))} />
                <p className="text-[10px] text-muted-foreground">
                  4 = Standard · 8 = schneller (32GB+)
                </p>
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {t("training.form.advanced")}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label>{t("training.form.learningRate")}</Label>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded cursor-help"
                      title="Wie schnell das Modell lernt. Zu hoch = instabiles Training. Zu niedrig = langsames Lernen. Empfehlung: 0.0001 für kurze Jobs, 0.00005 für lange Overnight-Jobs.">
                      ?
                    </span>
                  </div>
                  <Input type="number" step="0.00001" value={form.learning_rate}
                    onChange={e => setForm(p => ({ ...p, learning_rate: parseFloat(e.target.value) || 0.0001 }))} />
                  <p className="text-[10px] text-muted-foreground">
                    Kurz: 0.0001 · Overnight: 0.00005
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label>{t("training.form.maxSeqLength")}</Label>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded cursor-help"
                      title="Maximale Tokenlänge pro Trainingseintrag. Längere Einträge werden abgeschnitten (Warnung im Log). LUTZ-Daten haben bis zu 1004 Tokens → mindestens 1024 setzen!">
                      ?
                    </span>
                  </div>
                  <Input type="number" min={64} max={4096} step={64} value={form.max_seq_length}
                    onChange={e => setForm(p => ({ ...p, max_seq_length: parseInt(e.target.value) || 1024 }))} />
                  <p className="text-[10px] text-muted-foreground">
                    Min. so groß wie längster Dateneintrag
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSubmit} disabled={submitting || !form.name || !form.dataset_id}>
              <Play className="w-4 h-4 mr-2" />
              {submitting ? t("training.form.starting") : t("training.form.startTraining")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Jobs Table */}
        <div className="space-y-3">
          <Card className="glass-card">
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                <div className="py-12 text-center">
                  <Zap className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t("training.empty")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("training.table.name")}</TableHead>
                      <TableHead>{t("training.table.status")}</TableHead>
                      <TableHead>{t("training.table.loss")}</TableHead>
                      <TableHead className="hidden md:table-cell text-muted-foreground text-xs">Gestartet</TableHead>
                      <TableHead className="hidden md:table-cell text-muted-foreground text-xs">Dauer</TableHead>
                      <TableHead className="text-right">{t("training.table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map(job => (
                      <TableRow key={job.id} className={cn(logsJobId === job.id && "bg-primary/5", "cursor-pointer")} onClick={() => openLogs(job.id)}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm truncate max-w-[180px]">{job.name}</p>
                            <p className="text-xs text-muted-foreground">{job.base_model.split("/")[1]}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(job.status) as any}>
                            {t(`training.status.${job.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatLoss(job.final_loss ?? null)}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {job.created_at ? new Date(job.created_at + 'Z').toLocaleString('de-DE', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {job.started_at && job.finished_at
                            ? (() => { const s=Math.round((new Date(job.finished_at+'Z').getTime()-new Date(job.started_at+'Z').getTime())/60000); return s>60?`${Math.floor(s/60)}h ${s%60}m`:`${s}m` })()
                            : job.status === 'running' ? '⏳ läuft…' : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => openLogs(job.id)} title={t("training.viewLogs")}>
                              <FileText className="w-3.5 h-3.5" />
                            </Button>
                            {job.status === "completed" && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:text-primary"
                                onClick={(e) => { e.stopPropagation(); resumeJob(job.id) }}
                                title={t("training.resumeTitle")}>
                                <RefreshCw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(job) }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live Logs */}
        <Card className="glass-card flex flex-col h-[500px]">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  logsJobId ? "bg-primary animate-pulse" : "bg-muted"
                )} />
                {t("training.logs.title")}
                {logsJobId && <span className="text-muted-foreground font-normal">#{logsJobId}</span>}
              </CardTitle>
              {logs.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs"
                  onClick={() => setLogs([])}>
                  {t("training.logs.clear")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full px-4 pb-4">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">{t("training.logs.waiting")}</p>
                </div>
              ) : (
                <div className="space-y-0.5 font-mono text-xs">
                  {logs.filter(l => l.msg !== "__STREAM_END__").map((line, i) => (
                    <div key={i} className={cn("py-0.5", logColor(line.type))}>
                      {line.type === "cmd" && <span className="text-muted-foreground">$ </span>}
                      {line.msg}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("training.delete.title")}</DialogTitle>
            <DialogDescription>{t("training.delete.confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

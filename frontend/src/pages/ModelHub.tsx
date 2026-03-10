import { useState, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  Bot, Download, CheckCircle2, Search, RefreshCw,
  Heart, TrendingDown, FileText, HardDrive, Loader2,
  AlertCircle, ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { listHubModels, startDownload, listCachedModels, HubModel } from "@/api"

// ── Types ─────────────────────────────────────────────────────────────────────

interface DownloadState {
  status: "downloading" | "done" | "error" | "idle"
  progress: number
  size_downloaded: number
  speed: number
  error?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}

const FAMILIES = ["All", "Qwen", "Llama", "Mistral", "Gemma", "DeepSeek", "Phi"]

// ── Model Card ────────────────────────────────────────────────────────────────

function ModelCard({
  model,
  onDownload,
  downloadState,
}: {
  model: HubModel
  onDownload: (id: string) => void
  downloadState: DownloadState | null
}) {
  const { t } = useTranslation()
  const dl = downloadState
  const isCached = model.is_cached || dl?.status === "done"
  const isDownloading = dl?.status === "downloading"

  return (
    <Card className="flex flex-col gap-0 overflow-hidden border-border hover:border-primary/40 transition-colors">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm leading-tight truncate" title={model.name}>
              {model.name}
            </span>
          </div>
          {isCached && (
            <Badge variant="secondary" className="shrink-0 text-[10px] bg-green-500/15 text-green-500 border-green-500/30">
              {t("hub.cached")}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5" title={model.id}>
          {model.id}
        </p>
      </CardHeader>

      <CardContent className="px-4 pb-4 flex flex-col gap-3 flex-1">
        {/* Family + Size */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3" />
            {model.family}
          </span>
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            {model.size_label}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingDown className="w-3 h-3" />
            {formatDownloads(model.downloads)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="w-3 h-3" />
            {model.likes}
          </span>
          {model.license && model.license !== "unknown" && (
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{model.license}</span>
            </span>
          )}
        </div>

        {/* Tags */}
        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {model.languages.slice(0, 3).map((lang) => (
              <Badge key={lang} variant="outline" className="text-[9px] px-1 py-0 h-4">
                {lang}
              </Badge>
            ))}
            {model.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Description */}
        {model.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-2">{model.description}</p>
        )}

        {/* Separator */}
        <div className="h-px bg-border -mx-4" />

        {/* Download area */}
        <div className="mt-auto">
          {isCached ? (
            <div className="flex items-center gap-2 text-green-500 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-medium">{t("hub.cachedReady")}</span>
            </div>
          ) : isDownloading ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("hub.downloading")}
                </span>
                <span>{dl.progress}%</span>
              </div>
              <Progress value={dl.progress} className="h-1.5" />
              {dl.size_downloaded > 0 && (
                <p className="text-[10px] text-muted-foreground">{formatBytes(dl.size_downloaded)} {t("hub.downloaded")}</p>
              )}
            </div>
          ) : dl?.status === "error" ? (
            <div className="flex items-center gap-2 text-destructive text-xs">
              <AlertCircle className="w-3 h-3" />
              <span>{dl.error || t("hub.downloadError")}</span>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={() => onDownload(model.id)}
            >
              <Download className="w-3 h-3 mr-1" />
              {t("hub.download")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ModelHub() {
  const { t } = useTranslation()
  const [models, setModels] = useState<HubModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [family, setFamily] = useState("All")
  const [cachedCount, setCachedCount] = useState(0)
  const [cachedSize, setCachedSize] = useState("0 GB")
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({})
  const sseRefs = useRef<Record<string, EventSource>>({})

  // ── Load models ──────────────────────────────────────────────────────────
  const loadModels = async () => {
    try {
      setLoading(true)
      setError(null)
      const [hubResp, cacheResp] = await Promise.all([
        listHubModels(),
        listCachedModels(),
      ])
      setModels(hubResp.data.models)
      setCachedCount(cacheResp.data.models.length)
      setCachedSize(cacheResp.data.total_size_label || "0 GB")
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || t("common.error"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadModels()
    return () => {
      // Close all SSE connections on unmount
      Object.values(sseRefs.current).forEach((es) => es.close())
    }
  }, [])

  // ── Download ─────────────────────────────────────────────────────────────
  const handleDownload = async (modelId: string) => {
    try {
      await startDownload(modelId)
      setDownloads((d) => ({
        ...d,
        [modelId]: { status: "downloading", progress: 0, size_downloaded: 0, speed: 0 },
      }))
      startSSE(modelId)
    } catch (e: any) {
      setDownloads((d) => ({
        ...d,
        [modelId]: { status: "error", progress: 0, size_downloaded: 0, speed: 0, error: e?.message },
      }))
    }
  }

  const startSSE = (modelId: string) => {
    if (sseRefs.current[modelId]) {
      sseRefs.current[modelId].close()
    }
    const encoded = encodeURIComponent(modelId)
    const es = new EventSource(`/api/hub/download/${encoded}/status`)
    sseRefs.current[modelId] = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as DownloadState
        setDownloads((prev) => ({ ...prev, [modelId]: data }))
        if (data.status === "done") {
          es.close()
          // Refresh models to update is_cached flags
          loadModels()
        } else if (data.status === "error") {
          es.close()
        }
      } catch { /* ignore parse errors */ }
    }
    es.onerror = () => {
      es.close()
    }
  }

  // ── Filter ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return models.filter((m) => {
      const matchSearch =
        !search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.id.toLowerCase().includes(search.toLowerCase()) ||
        m.family.toLowerCase().includes(search.toLowerCase())
      const matchFamily = family === "All" || m.family.toLowerCase().startsWith(family.toLowerCase())
      return matchSearch && matchFamily
    })
  }, [models, search, family])

  const cachedModels = useMemo(() => models.filter((m) => m.is_cached || downloads[m.id]?.status === "done"), [models, downloads])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("hub.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("hub.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadModels} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Stat Bar */}
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-muted/40 border border-border text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          <Bot className="w-4 h-4 text-primary" />
          <strong>{models.length}</strong> {t("hub.statsModels")}
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="flex items-center gap-1.5 text-foreground">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <strong>{cachedCount}</strong> {t("hub.statsCached")}
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="flex items-center gap-1.5 text-foreground">
          <HardDrive className="w-4 h-4 text-blue-400" />
          <strong>{cachedSize}</strong> {t("hub.statsSize")}
        </span>
      </div>

      {/* Search + Family filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("hub.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={family} onValueChange={setFamily}>
          <TabsList className="h-9 flex-wrap">
            {FAMILIES.map((f) => (
              <TabsTrigger key={f} value={f} className="text-xs px-2.5">
                {f}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">{t("hub.loadingModels")}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Bot className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">{t("hub.noResults")}</p>
        </div>
      )}

      {/* Model Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onDownload={handleDownload}
              downloadState={downloads[model.id] || null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Database, Zap, BookOpen, Activity, Upload, Play, MessageSquare, TreePine } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getStats, listJobs, listModels, type Stats, type Job, type Model } from "@/api"
import { formatDate, formatLoss } from "@/lib/utils"

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [recentModels, setRecentModels] = useState<Model[]>([])

  useEffect(() => {
    getStats().then(r => setStats(r.data)).catch(console.error)
    listJobs().then(r => setRecentJobs(r.data.slice(0, 5))).catch(console.error)
    listModels().then(r => setRecentModels(r.data.slice(0, 5))).catch(console.error)
  }, [])

  const statusVariant = (s: string) =>
    s === "completed" ? "success" : s === "running" ? "running" : s === "failed" ? "failed" : "queued"

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/15 border border-primary/20">
          <TreePine className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("dashboard.subtitle")}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Database} label={t("dashboard.stats.datasets")} value={stats?.datasets ?? "—"} color="blue" />
        <StatCard icon={Zap} label={t("dashboard.stats.jobs")} value={stats?.jobs ?? "—"} color="orange" />
        <StatCard icon={BookOpen} label={t("dashboard.stats.models")} value={stats?.models ?? "—"} color="green" />
        <StatCard icon={Activity} label={t("dashboard.stats.running")} value={stats?.running_jobs ?? "—"} color="purple" pulse={!!stats?.running_jobs} />
      </div>

      {/* Quick Start */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("dashboard.quickstart.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickStep
              icon={Upload} step={1}
              title={t("dashboard.quickstart.step1")}
              desc={t("dashboard.quickstart.step1Desc")}
              onClick={() => navigate("/datasets")}
            />
            <QuickStep
              icon={Play} step={2}
              title={t("dashboard.quickstart.step2")}
              desc={t("dashboard.quickstart.step2Desc")}
              onClick={() => navigate("/training")}
            />
            <QuickStep
              icon={MessageSquare} step={3}
              title={t("dashboard.quickstart.step3")}
              desc={t("dashboard.quickstart.step3Desc")}
              onClick={() => navigate("/chat")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Recent content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t("dashboard.recentJobs")}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/training")} className="text-xs h-7">
                {t("common.actions")} →
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("dashboard.noJobs")}</p>
            ) : recentJobs.map(job => (
              <div key={job.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{job.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{job.base_model.split("/")[1]}</p>
                </div>
                <Badge variant={statusVariant(job.status) as any} className="ml-2 shrink-0">
                  {t(`training.status.${job.status}`)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Models */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t("dashboard.recentModels")}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/models")} className="text-xs h-7">
                {t("common.actions")} →
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentModels.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("dashboard.noModels")}</p>
            ) : recentModels.map(model => (
              <div key={model.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{model.name}</p>
                  <p className="text-xs text-muted-foreground">Loss: {formatLoss(model.final_loss ?? null)}</p>
                </div>
                <Button variant="outline" size="sm" className="ml-2 h-7 text-xs shrink-0"
                  onClick={() => navigate(`/chat/${model.id}`)}>
                  {t("common.test")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, pulse }: {
  icon: any; label: string; value: number | string; color: string; pulse?: boolean
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    orange: "bg-primary/10 text-primary border-primary/20",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    purple: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  }
  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-10 h-10 rounded-lg border ${colorMap[color]}`}>
            <Icon className={`w-5 h-5 ${pulse ? "animate-pulse" : ""}`} />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickStep({ icon: Icon, step, title, desc, onClick }: {
  icon: any; step: number; title: string; desc: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left p-4 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all group"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 border border-primary/20 group-hover:bg-primary/25 transition-colors">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">Schritt {step}</span>
      </div>
      <p className="font-medium text-sm">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </button>
  )
}

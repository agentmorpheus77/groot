import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { BookOpen, Trash2, MessageSquare, Info } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listModels, deleteModel, type Model } from "@/api"
import { formatDate, formatDuration, formatLoss } from "@/lib/utils"

export default function Models() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [models, setModels] = useState<Model[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Model | null>(null)
  const [infoTarget, setInfoTarget] = useState<Model | null>(null)

  const load = () => listModels().then(r => setModels(r.data)).catch(console.error)
  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteModel(deleteTarget.id).catch(console.error)
    load()
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <BookOpen className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("models.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("models.subtitle")}</p>
        </div>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          {models.length === 0 ? (
            <div className="py-12 text-center">
              <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("models.empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("models.table.name")}</TableHead>
                  <TableHead>{t("models.table.baseModel")}</TableHead>
                  <TableHead>{t("models.table.dataset")}</TableHead>
                  <TableHead>{t("models.table.loss")}</TableHead>
                  <TableHead>{t("models.table.duration")}</TableHead>
                  <TableHead>{t("models.table.created")}</TableHead>
                  <TableHead className="text-right">{t("models.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(model => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">
                      <div>
                        <p className="truncate max-w-[180px]">{model.name}</p>
                        <Badge variant={model.adapter_path ? "outline" : "secondary"} className="text-[10px] mt-0.5">
                          {model.adapter_path ? "Adapter" : "Fused"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px]">
                      <span className="truncate block">{model.base_model.split("/")[1]}</span>
                    </TableCell>
                    <TableCell className="text-sm">{model.dataset_name}</TableCell>
                    <TableCell>
                      {model.final_loss != null ? (
                        <Badge variant="success">{formatLoss(model.final_loss)}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(model.training_time_seconds)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(model.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => setInfoTarget(model)} title={t("models.info.title")}>
                          <Info className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="default" size="sm" className="h-7 text-xs"
                          onClick={() => navigate(`/chat/${model.id}`)}>
                          <MessageSquare className="w-3 h-3 mr-1" />
                          {t("models.chat")}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(model)}>
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

      {/* Info Dialog */}
      <Dialog open={!!infoTarget} onOpenChange={() => setInfoTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("models.info.title")}: {infoTarget?.name}</DialogTitle>
          </DialogHeader>
          {infoTarget && (
            <div className="space-y-3 text-sm">
              <InfoRow label={t("models.table.baseModel")} value={infoTarget.base_model} mono />
              <InfoRow label={t("models.table.dataset")} value={infoTarget.dataset_name} />
              <InfoRow label={t("models.table.loss")} value={formatLoss(infoTarget.final_loss ?? null)} />
              <InfoRow label={t("models.info.trainingTime")} value={formatDuration(infoTarget.training_time_seconds)} />
              {infoTarget.adapter_path && (
                <InfoRow label={t("models.info.adapterPath")} value={infoTarget.adapter_path} mono />
              )}
              {infoTarget.fused_path && (
                <InfoRow label={t("models.info.fusedPath")} value={infoTarget.fused_path} mono />
              )}
              <InfoRow label={t("models.table.created")} value={formatDate(infoTarget.created_at)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoTarget(null)}>{t("common.close")}</Button>
            <Button onClick={() => { setInfoTarget(null); navigate(`/chat/${infoTarget?.id}`) }}>
              <MessageSquare className="w-4 h-4 mr-2" />
              {t("models.chat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("models.delete.title")}</DialogTitle>
            <DialogDescription>{t("models.delete.confirm")}</DialogDescription>
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

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono text-xs break-all text-primary/80" : ""}`}>{value || "—"}</span>
    </div>
  )
}

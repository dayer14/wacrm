"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, ShoppingBag, LayoutKanban, RefreshCw, Truck, CheckCircle2, Clock, XCircle, UserCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";

interface Pedido {
  id: string;
  created_at: string;
  nombre: string;
  apellido?: string;
  telefono: string;
  producto?: string;
  cantidad?: number;
  monto_usd?: number;
  estado_pedido: string;
  guia_tealca?: string;
  agencia_tealca?: string;
  ciudad?: string;
}

const ESTADOS_PEDIDOS = [
  { id: "Nuevo", label: "Nuevo", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: Clock },
  { id: "Contactado", label: "Contactado", color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", icon: UserCheck },
  { id: "Confirmado", label: "Confirmado", color: "bg-purple-500/10 text-purple-500 border-purple-500/20", icon: CheckCircle2 },
  { id: "Enviado", label: "Enviado", color: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: Truck },
  { id: "En agencia", label: "En agencia", color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20", icon: AlertCircle },
  { id: "Entregado", label: "Entregado", color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", icon: CheckCircle2 },
  { id: "Cancelado", label: "Cancelado", color: "bg-rose-500/10 text-rose-500 border-rose-500/20", icon: XCircle },
];

const SPEC_DEFAULT_STAGES = [
  { nameKey: "newLead", color: "#3b82f6", position: 0 },
  { nameKey: "qualified", color: "#eab308", position: 1 },
  { nameKey: "proposalSent", color: "#f97316", position: 2 },
  { nameKey: "negotiation", color: "#8b5cf6", position: 3 },
  { nameKey: "won", color: "#22c55e", position: 4 },
] as const;

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const tGate = useTranslations("GatedButton");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  // Control de Vista: 'deals' (plantilla) o 'pedidos' (nueva tabla)
  const [activeTab, setActiveTab] = useState<"deals" | "pedidos">("deals");

  // Estados nativos CRM
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de Pedidos (Nueva Tabla)
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);

  // Dialogs nativos
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase.from("pipelines").select("*").order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase.from("pipeline_stages").select("*").eq("pipeline_id", pipelineId).order("position");
      return data ?? [];
    },
    [supabase]
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase]
  );

  const loadPedidos = useCallback(async () => {
    setLoadingPedidos(true);
    const { data, error } = await supabase.from("pedidos").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("Error cargando pedidos:", error.message);
      toast.error("Error cargando pedidos desde Supabase");
    } else {
      setPedidos(data ?? []);
    }
    setLoadingPedidos(false);
  }, [supabase]);

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: t("defaultPipelineName") })
      .select()
      .single();

    if (error || !pipeline) return null;

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: t(`defaultStages.${s.nameKey}`),
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && accountId && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0].id));
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, accountId]);

  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([loadStages(selectedPipelineId), loadDeals(selectedPipelineId)]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  useEffect(() => {
    if (activeTab === "pedidos") {
      loadPedidos();
    }
  }, [activeTab, loadPedidos]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId)) setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)));
      const { error } = await supabase.from("deals").update({ stage_id: newStageId }).eq("id", dealId);
      if (error) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t]
  );

  const handleMoverPedidoEstado = async (pedidoId: string, nuevoEstado: string) => {
    setPedidos((prev) => prev.map((p) => (p.id === pedidoId ? { ...p, estado_pedido: nuevoEstado } : p)));
    const { error } = await supabase.from("pedidos").update({ estado_pedido: nuevoEstado }).eq("id", pedidoId);
    if (error) {
      toast.error("No se pudo actualizar el pedido");
      loadPedidos();
    } else {
      toast.success(`Pedido actualizado a ${nuevoEstado}`);
    }
  };

  const handleAddDeal = useCallback((stageId?: string) => {
    setEditingDeal(null);
    setDefaultStageId(stageId ?? stages[0]?.id ?? "");
    setDealFormOpen(true);
  }, [stages]);

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: t(`defaultStages.${s.nameKey}`),
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pestañas de Navegación: Tratos CRM vs Pedidos */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 rounded-lg bg-muted p-1">
          <button
            onClick={() => setActiveTab("deals")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              activeTab === "deals" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutKanban className="h-4 w-4" />
            Tratos (CRM Original)
          </button>
          <button
            onClick={() => setActiveTab("pedidos")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              activeTab === "pedidos" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShoppingBag className="h-4 w-4 text-emerald-500" />
            Tabla Pedidos
          </button>
        </div>

        {activeTab === "pedidos" && (
          <Button variant="outline" size="sm" onClick={loadPedidos} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar Pedidos
          </Button>
        )}
      </div>

      {/* VISTA 1: CRM ORIGINAL DEALS */}
      {activeTab === "deals" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <GitBranch className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{selectedPipeline?.name ?? t("selectPipeline")}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 border-border bg-popover text-popover-foreground">
                  {pipelines.length === 0 && (
                    <DropdownMenuItem disabled className="text-muted-foreground">
                      {t("noPipelinesYet")}
                    </DropdownMenuItem>
                  )}
                  {pipelines.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => setSelectedPipelineId(p.id)}
                      className={p.id === selectedPipelineId ? "text-primary" : "text-popover-foreground"}
                    >
                      <GitBranch className="mr-2 h-3.5 w-3.5" />
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-border" />
                  {selectedPipeline && (
                    <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="text-popover-foreground">
                      <Settings className="mr-2 h-3.5 w-3.5" />
                      {t("managePipelines")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-2">
              <GatedButton
                variant="outline"
                canAct={canEditSettings}
                gateReason={tGate("reasons.createPipelines")}
                onClick={() => setNewPipelineOpen(true)}
                className="border-border bg-card text-foreground hover:bg-muted"
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("addPipeline")}
              </GatedButton>
              <GatedButton
                canAct={canCreateDeals}
                gateReason={tGate("reasons.createDeals")}
                disabled={!selectedPipelineId || stages.length === 0}
                onClick={() => handleAddDeal()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("addDeal")}
              </GatedButton>
            </div>
          </div>

          {pipelines.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
              <GitBranch className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium text-foreground">{t("noPipelinesYet")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("createToStartTracking")}</p>
              <GatedButton
                canAct={canEditSettings}
                gateReason={tGate("reasons.createPipelines")}
                onClick={() => setNewPipelineOpen(true)}
                className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("createPipeline")}
              </GatedButton>
            </div>
          ) : (
            <>
              <PipelineAnalytics stages={stages} deals={deals} />
              <PipelineBoard
                stages={stages}
                deals={deals}
                onDealMoved={handleDealMoved}
                onAddDeal={handleAddDeal}
                onEditDeal={handleEditDeal}
              />
            </>
          )}
        </>
      )}

      {/* VISTA 2: NUEVA TABLA PEDIDOS */}
      {activeTab === "pedidos" && (
        <div className="flex gap-4 overflow-x-auto pb-6">
          {loadingPedidos ? (
            <div className="p-4 text-sm text-muted-foreground">Cargando pedidos de Supabase...</div>
          ) : (
            ESTADOS_PEDIDOS.map((columna) => {
              const pedidosCol = pedidos.filter((p) => (p.estado_pedido || "Nuevo") === columna.id);
              const Icon = columna.icon;
              return (
                <div key={columna.id} className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-card/50 p-3">
                  <div className="mb-3 flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md border p-1 ${columna.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-semibold text-sm text-foreground">{columna.label}</span>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {pedidosCol.length}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
                    {pedidosCol.length === 0 ? (
                      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
                        Sin pedidos
                      </div>
                    ) : (
                      pedidosCol.map((p) => (
                        <div key={p.id} className="rounded-lg border border-border bg-card p-3 shadow-sm hover:border-primary/40 transition-all">
                          <div className="flex items-start justify-between">
                            <span className="font-medium text-sm text-foreground">{p.nombre} {p.apellido || ""}</span>
                            {p.monto_usd && <span className="font-bold text-xs text-emerald-500">${p.monto_usd} USD</span>}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{p.telefono}</p>
                          {p.producto && (
                            <div className="mt-2 rounded bg-muted/60 px-2 py-1 text-xs font-medium text-foreground">
                              {p.cantidad || 1}x {p.producto}
                            </div>
                          )}
                          <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2">
                            <span className="text-[10px] text-muted-foreground">Mover a:</span>
                            <select
                              value={p.estado_pedido || "Nuevo"}
                              onChange={(e) => handleMoverPedidoEstado(p.id, e.target.value)}
                              className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none"
                            >
                              {ESTADOS_PEDIDOS.map((e) => (
                                <option key={e.id} value={e.id}>{e.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Dialogs Nativos */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t("defaultStagesDesc")}</p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)} className="border-border text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleCreatePipeline} disabled={creating || !newPipelineName.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
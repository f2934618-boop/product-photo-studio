"use client";

import * as React from "react";
import {
  Ban,
  Check,
  Copy,
  Database,
  KeyRound,
  LogIn,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { copyText } from "@/lib/clipboard";
import { authHeader } from "@/lib/supabase";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "disabled";
  requestCount: number;
  createdAt: string;
  lastUsedAt: string | null;
};

type LoadState = "idle" | "loading" | "ready" | "error" | "not-configured" | "denied";

function formatDate(value: string | null): string {
  if (!value) return "尚未使用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function requestHeaders(json = false): Promise<Record<string, string>> {
  return {
    ...(await authHeader()),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export function ApiKeyManager() {
  const { user, ready } = useAuth();
  const { openAuth } = useAuthModal();
  const { toast } = useToast();
  const [state, setState] = React.useState<LoadState>("idle");
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [name, setName] = React.useState("生产环境");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [freshSecret, setFreshSecret] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!user) return;
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/developer-keys", {
        headers: await requestHeaders(),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        keys?: ApiKeyRow[];
        error?: string;
      };
      if (response.status === 503) {
        setState("not-configured");
        setError(data.error || "数据库未配置");
        return;
      }
      if (response.status === 401) {
        setState("denied");
        return;
      }
      if (!response.ok) throw new Error(data.error || "加载失败");
      setKeys(data.keys || []);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setState("error");
    }
  }, [user]);

  React.useEffect(() => {
    if (!ready) return;
    if (!user) {
      setState("idle");
      setKeys([]);
      return;
    }
    void load();
  }, [ready, user, load]);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) {
      toast("请输入 Key 名称", "error");
      return;
    }
    setBusy("create");
    setFreshSecret(null);
    try {
      const response = await fetch("/api/developer-keys", {
        method: "POST",
        headers: await requestHeaders(true),
        body: JSON.stringify({ name: clean }),
      });
      const data = (await response.json()) as {
        key?: ApiKeyRow;
        secret?: string;
        error?: string;
      };
      if (!response.ok || !data.key || !data.secret) {
        throw new Error(data.error || "创建失败");
      }
      setKeys((current) => [data.key!, ...current]);
      setFreshSecret(data.secret);
      setName("");
      toast("API Key 已创建，请立即保存", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "创建失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function copySecret() {
    if (!freshSecret) return;
    if (await copyText(freshSecret)) toast("完整 Key 已复制", "success");
    else toast("复制失败，请手动选择", "error");
  }

  async function disableKey(key: ApiKeyRow) {
    if (!window.confirm(`停用「${key.name}」？使用该 Key 的请求会立即失败。`)) return;
    setBusy(key.id);
    try {
      const response = await fetch("/api/developer-keys", {
        method: "PATCH",
        headers: await requestHeaders(true),
        body: JSON.stringify({ id: key.id }),
      });
      const data = (await response.json()) as { key?: ApiKeyRow; error?: string };
      if (!response.ok || !data.key) throw new Error(data.error || "停用失败");
      setKeys((current) => current.map((item) => (item.id === key.id ? data.key! : item)));
      toast("API Key 已停用", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "停用失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteKey(key: ApiKeyRow) {
    if (!window.confirm(`永久删除「${key.name}」？此操作无法撤销。`)) return;
    setBusy(key.id);
    try {
      const response = await fetch("/api/developer-keys", {
        method: "DELETE",
        headers: await requestHeaders(true),
        body: JSON.stringify({ id: key.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败");
      setKeys((current) => current.filter((item) => item.id !== key.id));
      toast("API Key 已删除", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "删除失败", "error");
    } finally {
      setBusy(null);
    }
  }

  if (!ready || state === "loading") {
    return (
      <div className="space-y-4" aria-label="正在加载 API Key">
        <div className="h-11 animate-pulse rounded-[10px] bg-c-subtle2" />
        <div className="h-24 animate-pulse rounded-[14px] bg-c-subtle2" />
      </div>
    );
  }

  if (!user || state === "denied") {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[14px] border border-c-border bg-c-subtle2 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-c-card text-acc shadow-sm">
            <LogIn className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-c-text">登录后管理 API Key</h3>
            <p className="mt-1 text-[13px] leading-5 text-c-text3">Key 会绑定到当前账号，并使用该账号的积分与作品空间。</p>
          </div>
        </div>
        <Button type="button" onClick={() => openAuth("sign-in")}>
          登录账号
        </Button>
      </div>
    );
  }

  if (state === "not-configured") {
    return (
      <div className="rounded-[14px] border border-c-border bg-c-subtle2 p-6">
        <div className="flex gap-3">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-acc" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-c-text">需要配置数据库</h3>
            <p className="mt-1 text-[13px] leading-5 text-c-text3">{error}</p>
            <p className="mt-3 rounded-[8px] border border-c-border bg-c-card px-3 py-2 font-mono text-[12px] text-c-text2">
              DATABASE_URL=postgresql://user:password@host:5432/database
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center justify-between gap-4 rounded-[14px] border border-c-border bg-c-subtle2 p-5">
        <p className="text-[13px] text-c-danger">{error || "API Key 加载失败"}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={createKey} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-2">
          <span className="text-[12.5px] font-medium text-c-text2">Key 名称</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：生产环境"
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <Button type="submit" loading={busy === "create"} className="h-[42px]">
          <Plus className="h-4 w-4" aria-hidden="true" />
          创建 API Key
        </Button>
      </form>

      {freshSecret && (
        <div className="rounded-[14px] border border-acc-border bg-acc-tint p-5" role="status">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-acc" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-semibold text-c-text">请立即复制并安全保存</p>
                <p className="mt-1 text-[12.5px] text-c-text3">完整 Key 只展示这一次，关闭后无法再次查看。</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFreshSecret(null)}
              className="rounded-[7px] p-1 text-c-text3 transition-colors hover:bg-c-card hover:text-c-text"
              aria-label="关闭密钥提示"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 select-all overflow-x-auto rounded-[9px] border border-c-border bg-c-card px-3 py-2.5 font-mono text-[12px] text-c-text">
              {freshSecret}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copySecret()}>
              <Copy className="h-3.5 w-3.5" />
              复制
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[14px] border border-c-border bg-c-card">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-c-subtle2 text-c-text3">
              <KeyRound className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[14px] font-medium text-c-text">还没有 API Key</p>
            <p className="mt-1 text-[12.5px] text-c-text3">创建后即可通过 X-API-Key 或 Bearer 认证调用接口。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-c-border bg-c-subtle2 text-[11.5px] font-medium text-c-text3">
                <tr>
                  <th className="px-4 py-3">名称 / Key</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">调用次数</th>
                  <th className="px-4 py-3">最后使用</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-c-border">
                {keys.map((key) => (
                  <tr key={key.id} className="text-[12.5px]">
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-c-text">{key.name}</p>
                      <code className="mt-1 block font-mono text-[11.5px] text-c-text3">{key.prefix}</code>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                        key.status === "active"
                          ? "bg-c-tint-g text-c-success-strong"
                          : "bg-c-subtle text-c-text3"
                      }`}>
                        {key.status === "active" ? <Check className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                        {key.status === "active" ? "使用中" : "已停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-c-text2">{key.requestCount.toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3.5 text-c-text3">{formatDate(key.lastUsedAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end gap-1">
                        {key.status === "active" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy === key.id}
                            onClick={() => void disableKey(key)}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            停用
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={busy === key.id}
                          onClick={() => void deleteKey(key)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

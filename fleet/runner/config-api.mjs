import { getProvider, resolveProvider, resolveModel } from "./providers/registry.mjs";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const cleanString = (v) => String(v || "").trim();

function numberOr(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const out = clamp(n, min, max);
  return integer ? Math.round(out) : out;
}

export function publicAppConfig(app, fleet = {}) {
  const provider = resolveProvider(app);
  return {
    providerId: provider?.id || "",
    providerModel: app?.provider?.model || app?.model || "",
    providerLabel: provider?.label || "",
    reasoning: app?.reasoning || "medium",
    model: app?.model || "",
    budget: app?.budget || app?.provider?.budget || {},
    retryCap: app?.retryCap ?? fleet.defaultRetryCap,
  };
}

export function publicFleetConfig(fleet = {}) {
  return {
    intervalMinutes: numberOr(fleet.intervalMinutes, 5, { min: 1, max: 1440, integer: true }),
    maxConcurrentLoops: numberOr(fleet.maxConcurrentLoops, 3, { min: 1, max: 20, integer: true }),
    maxUnattendedHours: numberOr(fleet.maxUnattendedHours, 48, { min: 1, max: 24 * 60, integer: true }),
    defaultRetryCap: numberOr(fleet.defaultRetryCap, 2, { min: 1, max: 10, integer: true }),
    notifications: {
      desktop: fleet.notifications?.desktop !== false,
      email: !!fleet.notifications?.email,
      mobile: !!fleet.notifications?.mobile,
      webhook: cleanString(fleet.notifications?.webhook),
      categories: {
        needs: fleet.notifications?.categories?.needs !== false,
        review: fleet.notifications?.categories?.review !== false,
        stuck: fleet.notifications?.categories?.stuck !== false,
        cap: fleet.notifications?.categories?.cap !== false,
        win: fleet.notifications?.categories?.win !== false,
      },
    },
    budget: {
      dailyUsd: numberOr(fleet.budget?.dailyUsd, 0, { min: 0, max: 100000 }),
      monthlyUsd: numberOr(fleet.budget?.monthlyUsd, 0, { min: 0, max: 1000000 }),
      alertPct: numberOr(fleet.budget?.alertPct, 80, { min: 1, max: 100, integer: true }),
    },
    quietHours: {
      enabled: !!fleet.quietHours?.enabled,
      start: /^([01]\d|2[0-3]):[0-5]\d$/.test(fleet.quietHours?.start || "") ? fleet.quietHours.start : "22:00",
      end: /^([01]\d|2[0-3]):[0-5]\d$/.test(fleet.quietHours?.end || "") ? fleet.quietHours.end : "07:00",
    },
    schedule: {
      overnightDrain: {
        enabled: !!fleet.schedule?.overnightDrain?.enabled,
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(fleet.schedule?.overnightDrain?.start || "") ? fleet.schedule.overnightDrain.start : "22:30",
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(fleet.schedule?.overnightDrain?.end || "") ? fleet.schedule.overnightDrain.end : "06:30",
      },
    },
    routing: {
      fallback: Array.isArray(fleet.routing?.fallback) ? fleet.routing.fallback.map(cleanString).filter(Boolean).slice(0, 8) : [],
    },
  };
}

export function applyAppConfigPatch(cfg, body = {}) {
  if (!cfg || !Array.isArray(cfg.apps)) return { ok: false, status: 500, error: "config has no apps array" };
  const slug = cleanString(body.slug);
  const app = cfg.apps.find((a) => a.slug === slug);
  if (!app) return { ok: false, status: 404, error: "no such app" };

  if (body.reasoning !== undefined) {
    const reasoning = cleanString(body.reasoning).toLowerCase();
    if (!["low", "medium", "high"].includes(reasoning)) return { ok: false, status: 400, error: "reasoning must be low, medium, or high" };
    app.reasoning = reasoning;
  }

  if (body.providerId !== undefined) {
    const providerId = cleanString(body.providerId);
    if (providerId) {
      const provider = getProvider(providerId);
      if (!provider) return { ok: false, status: 400, error: "unknown provider" };
      app.provider = { ...(app.provider || {}), id: providerId };
    } else if (app.provider) {
      delete app.provider.id;
      if (!Object.keys(app.provider).length) delete app.provider;
    }
  }

  if (body.providerModel !== undefined) {
    const model = cleanString(body.providerModel);
    if (model) {
      app.provider = { ...(app.provider || {}), model };
      app.model = model;
    } else {
      if (app.provider) delete app.provider.model;
      delete app.model;
      if (app.provider && !Object.keys(app.provider).length) delete app.provider;
    }
  } else if (body.model !== undefined) {
    const model = cleanString(body.model);
    if (model) app.model = model;
    else delete app.model;
  }

  if (body.budget !== undefined) {
    const budget = body.budget || {};
    const next = { ...(app.budget || {}) };
    if (budget.dailyUsd !== undefined) {
      const v = numberOr(budget.dailyUsd, 0, { min: 0, max: 100000 });
      if (v > 0) next.dailyUsd = v; else delete next.dailyUsd;
    }
    if (budget.monthlyUsd !== undefined) {
      const v = numberOr(budget.monthlyUsd, 0, { min: 0, max: 1000000 });
      if (v > 0) next.monthlyUsd = v; else delete next.monthlyUsd;
    }
    if (Object.keys(next).length) app.budget = next;
    else delete app.budget;
  }

  const provider = resolveProvider(app);
  return {
    ok: true,
    status: 200,
    app,
    config: {
      ...publicAppConfig(app, cfg.fleet || {}),
      resolvedModel: resolveModel(app, provider),
    },
  };
}

export function applyFleetConfigPatch(cfg, body = {}) {
  if (!cfg) return { ok: false, status: 500, error: "config unreadable" };
  const patch = body.fleet || body;
  cfg.fleet = cfg.fleet || {};
  const fleet = cfg.fleet;

  if (patch.intervalMinutes !== undefined) fleet.intervalMinutes = numberOr(patch.intervalMinutes, 5, { min: 1, max: 1440, integer: true });
  if (patch.maxConcurrentLoops !== undefined) fleet.maxConcurrentLoops = numberOr(patch.maxConcurrentLoops, 3, { min: 1, max: 20, integer: true });
  if (patch.maxUnattendedHours !== undefined) fleet.maxUnattendedHours = numberOr(patch.maxUnattendedHours, 48, { min: 1, max: 24 * 60, integer: true });
  if (patch.defaultRetryCap !== undefined) fleet.defaultRetryCap = numberOr(patch.defaultRetryCap, 2, { min: 1, max: 10, integer: true });

  if (patch.notifications !== undefined) {
    fleet.notifications = { ...(fleet.notifications || {}) };
    if (patch.notifications.desktop !== undefined) fleet.notifications.desktop = !!patch.notifications.desktop;
    if (patch.notifications.email !== undefined) fleet.notifications.email = !!patch.notifications.email;
    if (patch.notifications.mobile !== undefined) fleet.notifications.mobile = !!patch.notifications.mobile;
    if (patch.notifications.webhook !== undefined) {
      const webhook = cleanString(patch.notifications.webhook);
      if (webhook) fleet.notifications.webhook = webhook;
      else delete fleet.notifications.webhook;
    }
    if (patch.notifications.categories !== undefined) {
      fleet.notifications.categories = { ...(fleet.notifications.categories || {}) };
      for (const key of ["needs", "review", "stuck", "cap", "win"]) {
        if (patch.notifications.categories[key] !== undefined) fleet.notifications.categories[key] = !!patch.notifications.categories[key];
      }
    }
  }

  if (patch.budget !== undefined) {
    fleet.budget = { ...(fleet.budget || {}) };
    const budget = patch.budget || {};
    if (budget.dailyUsd !== undefined) {
      const v = numberOr(budget.dailyUsd, 0, { min: 0, max: 100000 });
      if (v > 0) fleet.budget.dailyUsd = v; else delete fleet.budget.dailyUsd;
    }
    if (budget.monthlyUsd !== undefined) {
      const v = numberOr(budget.monthlyUsd, 0, { min: 0, max: 1000000 });
      if (v > 0) fleet.budget.monthlyUsd = v; else delete fleet.budget.monthlyUsd;
    }
    if (budget.alertPct !== undefined) fleet.budget.alertPct = numberOr(budget.alertPct, 80, { min: 1, max: 100, integer: true });
    if (!Object.keys(fleet.budget).length) delete fleet.budget;
  }

  if (patch.quietHours !== undefined) {
    const q = patch.quietHours || {};
    fleet.quietHours = { ...(fleet.quietHours || {}) };
    if (q.enabled !== undefined) fleet.quietHours.enabled = !!q.enabled;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(q.start || "")) fleet.quietHours.start = q.start;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(q.end || "")) fleet.quietHours.end = q.end;
  }

  if (patch.schedule !== undefined) {
    const s = patch.schedule || {};
    fleet.schedule = { ...(fleet.schedule || {}) };
    if (s.overnightDrain !== undefined) {
      const o = s.overnightDrain || {};
      fleet.schedule.overnightDrain = { ...(fleet.schedule.overnightDrain || {}) };
      if (o.enabled !== undefined) fleet.schedule.overnightDrain.enabled = !!o.enabled;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(o.start || "")) fleet.schedule.overnightDrain.start = o.start;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(o.end || "")) fleet.schedule.overnightDrain.end = o.end;
    }
  }

  if (patch.routing !== undefined) {
    const r = patch.routing || {};
    fleet.routing = { ...(fleet.routing || {}) };
    // Backward compatibility only: older configs/UI builds may still send tier-routing fields.
    // P0-3 intentionally makes only routing.fallback active; routine/standard/risky are stored
    // but are not exposed by publicFleetConfig and are not consumed by the runner.
    for (const key of ["routine", "standard", "risky"]) {
      if (r[key] !== undefined) {
        const v = cleanString(r[key]);
        if (v) fleet.routing[key] = v;
        else delete fleet.routing[key];
      }
    }
    if (r.fallback !== undefined) {
      const fallback = Array.isArray(r.fallback) ? r.fallback.map(cleanString).filter(Boolean).slice(0, 8) : [];
      if (fallback.length) fleet.routing.fallback = fallback;
      else delete fleet.routing.fallback;
    }
  }

  return { ok: true, status: 200, fleet: publicFleetConfig(fleet) };
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((x) => Number(x));
  return h * 60 + m;
}

export function isWithinQuietHours(fleet = {}, date = new Date()) {
  const q = publicFleetConfig(fleet).quietHours;
  if (!q.enabled) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

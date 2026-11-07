/**
 * ICT Backtest Journal - Central Configuration
 * Supports environment variables, window.ENV, localStorage overrides, and runtime configuration.
 */
(function (root) {
  "use strict";

  const DEFAULT_CONFIG = {
    SUPABASE_URL: "https://pbtvsuattqffhmsswmtf.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_d0PGWdWUjc-QURtP6IUQlw_iTJ6NkK8",
    IMGBB_API_KEY: "0c9d4b5806991d483ea660e4aad06717",
  };

  const storedUrl = typeof localStorage !== "undefined" ? localStorage.getItem("ict_supabase_url") : null;
  const storedKey = typeof localStorage !== "undefined" ? localStorage.getItem("ict_supabase_key") : null;
  const storedImgbb = typeof localStorage !== "undefined" ? localStorage.getItem("ict_imgbb_key") : null;

  const env = root.ENV || (typeof process !== "undefined" && process.env) || {};

  const config = {
    SUPABASE_URL: storedUrl || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_CONFIG.SUPABASE_URL,
    SUPABASE_ANON_KEY: storedKey || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || DEFAULT_CONFIG.SUPABASE_ANON_KEY,
    IMGBB_API_KEY: storedImgbb || env.IMGBB_API_KEY || DEFAULT_CONFIG.IMGBB_API_KEY,

    isConfigured: function () {
      return Boolean(this.SUPABASE_URL && this.SUPABASE_ANON_KEY);
    },

    update: function (cfg) {
      if (!cfg) return;
      if (typeof cfg.SUPABASE_URL === "string") {
        this.SUPABASE_URL = cfg.SUPABASE_URL.trim();
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ict_supabase_url", this.SUPABASE_URL);
        }
      }
      if (typeof cfg.SUPABASE_ANON_KEY === "string") {
        this.SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY.trim();
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ict_supabase_key", this.SUPABASE_ANON_KEY);
        }
      }
      if (typeof cfg.IMGBB_API_KEY === "string") {
        this.IMGBB_API_KEY = cfg.IMGBB_API_KEY.trim();
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ict_imgbb_key", this.IMGBB_API_KEY);
        }
      }
    },
  };

  root.ICT_CONFIG = config;
})(typeof globalThis !== "undefined" ? globalThis : this);


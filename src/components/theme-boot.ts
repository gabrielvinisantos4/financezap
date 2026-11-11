/** Roda antes da pintura: escolha salva, senão o tema do aparelho. */
export const THEME_BOOT = `(function(){try{var r=document.documentElement;var t=localStorage.getItem("fz-theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}r.dataset.theme=t}catch(e){}})();`;

/* =====================================================================
   ONE WORKER, THE WHOLE GAME

   Static assets and the catalogue on the same hostname, which is not a
   tidiness point - it is what makes the service worker's job possible.
   sw.js caches everything by relative path and deliberately lets
   anything under api/ fall through to the network. Same origin means no
   CORS, no preflight, one service-worker scope, one deploy, and a game
   that plays with the network off and a catalogue that is simply absent
   when it is.

   Requests for files never reach this code at all: Cloudflare serves
   assets before the Worker runs, free and uncounted, so the megabyte of
   three.js costs nothing however many people load it. Only api/ is
   metered, which is the whole reason for this shape.
   ===================================================================== */
import { handle, stripeHook } from "./api.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
      /* Stripe's own verifier needs Node crypto, which does not exist
         here, so it has to be handed the WebCrypto one - this is the
         thing that bites on the first deploy and looks like a bad
         signing secret. */
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      const provider = Stripe.createSubtleCryptoProvider();
      return stripeHook(req, env, (raw, sig, secret) =>
        stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, provider));
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const out = await handle(req, env, ctx);
        if (out) return out;
      } catch (err) {
        /* never leak the inside of the database to the outside */
        console.error("api", url.pathname, err && err.stack);
        return new Response(JSON.stringify({ error: "something went wrong down here" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
    }

    /* everything else is the game itself */
    return env.ASSETS.fetch(req);
  }
};

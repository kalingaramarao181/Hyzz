# API boundary

`client.js` is the single frontend API client factory. `transport.cjs` maps maintained SDK authentication/data/storage calls to the Node API; no frontend includes a Supabase URL or provider key. Tokens remain managed by the Auth SDK and kept in mobile SecureStore (admin/browser preview sessions use memory).

The API server origin comes from `../config.js`, with per-application overrides in customer/driver/admin `src/config/api.js`. Do not put secrets in these files. The backend `src/modules` folder owns request validation and routes; SQL migrations own transactional business rules and RLS.

Document viewing returns a short-lived authorized Storage URL. That file URL can point to Supabase; login, data, booking, account-creation and upload calls go through Node. No provider WebSocket is created; foreground reconciliation uses the Node API.

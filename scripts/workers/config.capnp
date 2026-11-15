using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "streamcheck", worker = (
      modules = [(name = "consumer.mjs", esModule = embed "consumer.mjs")],
      compatibilityDate = "2026-07-30",
      compatibilityFlags = ["nodejs_compat"],
      globalOutbound = "internet"
    )),
    # Defining internet explicitly replaces workerd's implicit public network.
    # No network service, external service, listening socket, or disk binding exists.
    (name = "internet", worker = (
      modules = [(name = "deny.mjs", esModule = "export default { fetch() { console.error('STREAMCHECK_FORBIDDEN_EGRESS'); throw new Error('External network forbidden'); } };")],
      compatibilityDate = "2026-07-30",
      globalOutbound = "internet"
    ))
  ],
  sockets = []
);

import { DATABASE_URL_VARS, databaseEnvNames } from "@/lib/database-url";

/**
 * "No database" banner, with enough to fix it. The old text named only
 * DATABASE_URL, which sent people with a database attached (under a prefix,
 * or only for Preview) looking for the wrong problem. Lists the names the
 * app accepts and the database-looking names it can actually see. Names only:
 * a value never leaves the server.
 */
export function NoDatabaseNotice({ children }: { children?: React.ReactNode }) {
  const seen = databaseEnvNames();
  return (
    <div
      data-testid="no-database"
      className="mb-6 space-y-2 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm"
    >
      <p>
        No database connection string found. {children}
      </p>
      <p className="text-xs">
        The app looks for {DATABASE_URL_VARS.join(", ")}, or any of them with a prefix such as{" "}
        <code>MY_POSTGRES_URL</code>, holding a Postgres URL.
      </p>
      <p className="text-xs" data-testid="no-database-seen">
        {seen.length
          ? `Database variables this deployment can see: ${seen.join(", ")}.`
          : "This deployment sees no database variables at all. In Vercel, connect the database to this project for the Production environment, then redeploy."}
      </p>
    </div>
  );
}

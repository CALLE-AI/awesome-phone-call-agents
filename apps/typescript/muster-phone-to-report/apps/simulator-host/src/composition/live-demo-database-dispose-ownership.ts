import { createDisposablePostgresOwner } from "@muster/infrastructure-postgres";

import type { LiveDemoDatabaseDisposeOwnershipCapabilities } from "../cli/live-demo-database-dispose.js";

export const liveDemoDatabaseDisposeOwnershipCapabilities: LiveDemoDatabaseDisposeOwnershipCapabilities =
  Object.freeze({ createDisposablePostgresOwner });

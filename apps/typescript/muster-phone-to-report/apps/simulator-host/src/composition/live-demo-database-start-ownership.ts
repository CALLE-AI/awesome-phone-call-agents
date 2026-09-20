import {
  createDisposablePostgresOwner,
  provisionExclusiveDisposablePostgresDatabaseOwnership,
} from "@muster/infrastructure-postgres";

import type { LiveDemoDatabaseStartOwnershipCapabilities } from "../cli/live-demo-database-start.js";

export const liveDemoDatabaseStartOwnershipCapabilities: LiveDemoDatabaseStartOwnershipCapabilities =
  Object.freeze({
    provisionExclusiveDisposablePostgresDatabaseOwnership,
    createDisposablePostgresOwner,
  });

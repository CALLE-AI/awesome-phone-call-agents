import { openDatabase } from "../src/infrastructure/db";

openDatabase();
process.stdout.write("Migrations applied.\n");

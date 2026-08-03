import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseConfig } from './database.config';
import * as schema from './database.schema';

export type Database = PostgresJsDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly db: Database;
  private readonly client: ReturnType<typeof postgres>;

  constructor(
    @Inject(databaseConfig.KEY)
    config: ConfigType<typeof databaseConfig>,
  ) {
    this.client = postgres(config.url, { max: 10 });
    this.db = drizzle(this.client, { schema });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

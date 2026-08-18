/**
 * Supabase Storage Adapter
 * Implements IStorageProvider using Supabase Storage (free tier).
 * Bucket: ccj-artifacts
 */

import { createClient } from "@supabase/supabase-js";
import type { IStorageProvider, StorageObject } from "../index.js";

const BUCKET = "ccj-artifacts";

export class SupabaseStorageProvider implements IStorageProvider {
  readonly name = "supabase-storage";
  private client;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { error } = await this.client.storage.getBucket(BUCKET);
      if (error?.message?.includes("not found")) {
        await this.client.storage.createBucket(BUCKET, { public: false });
      }
      return true;
    } catch {
      return false;
    }
  }

  async upload(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject> {
    const { error } = await this.client.storage.from(BUCKET).upload(key, data, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return {
      key,
      url: this.client.storage.from(BUCKET).getPublicUrl(key).data.publicUrl,
      size: data.byteLength,
      contentType,
      createdAt: new Date().toISOString(),
    };
  }

  async download(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(BUCKET).download(key);
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(key, expiresInSeconds);
    if (error || !data) throw new Error(`Supabase signed URL failed: ${error?.message}`);
    return data.signedUrl;
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([key]);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }

  async exists(key: string): Promise<boolean> {
    const { data } = await this.client.storage.from(BUCKET).list(key.split("/").slice(0, -1).join("/"));
    return (data ?? []).some((f) => f.name === key.split("/").at(-1));
  }
}

export class SqlJobStore {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    await this.connection.query(`CREATE TABLE IF NOT EXISTS eliza_shadow_jobs (
      job_id text PRIMARY KEY,
      input_hash text NOT NULL,
      request_hash text NOT NULL,
      state text NOT NULL CHECK (state IN ('running','succeeded','failed','unknown')),
      result jsonb,
      result_expires_at timestamptz,
      error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.purgeExpired();
  }

  async purgeExpired() {
    const purged = await this.connection.query(
      `UPDATE eliza_shadow_jobs SET result=NULL,updated_at=now()
       WHERE result IS NOT NULL AND result_expires_at <= now() RETURNING job_id`,
    );
    return purged.rows.length;
  }

  async isReady() {
    await this.connection.query("SELECT 1");
    return true;
  }

  async inspect(jobId) {
    const { rows } = await this.connection.query(
      `SELECT job_id,input_hash,request_hash,state,error_code,created_at,updated_at,
       result->'version' AS result_version,
       result->>'runtimeVersion' AS result_runtime_version,
       result->>'jobId' AS result_job_id,
       result->>'inputHash' AS result_input_hash,
       result#>>'{completion,model}' AS served_model,
       result#>>'{completion,object}' AS completion_object,
       length(result#>>'{completion,id}') AS completion_id_length,
       jsonb_array_length(result#>'{completion,choices}') AS choice_count,
       jsonb_typeof(result#>'{completion,choices,0,finish_reason}') AS finish_reason_type,
       result#>'{completion,created}' AS completion_created,
       result#>'{completion,choices,0,index}' AS choice_index,
       result#>>'{completion,choices,0,message,role}' AS choice_role,
       jsonb_typeof(result#>'{completion,choices,0,message,content}') AS content_type,
       jsonb_typeof(result#>'{completion,choices,0,message,tool_calls}') AS tool_calls_type,
       result#>'{completion,usage,prompt_tokens}' AS prompt_tokens,
       result#>'{completion,usage,completion_tokens}' AS completion_tokens,
       result#>'{completion,usage,total_tokens}' AS total_tokens
       FROM eliza_shadow_jobs WHERE job_id=$1 LIMIT 1`,
      [jobId],
    );
    return rows[0] ?? null;
  }

  /** Read an already committed fresh receipt. Never claim, purge or infer. */
  async receipt({ jobId, inputHash, agentSlug, stage }) {
    const { rows } = await this.connection.query(
      `SELECT result FROM eliza_shadow_jobs
       WHERE job_id=$1 AND input_hash=$2 AND state='succeeded'
       AND result_expires_at > now() AND created_at > now() - interval '2 minutes'
       AND result->>'agentSlug'=$3 AND result->>'stage'=$4 LIMIT 1`,
      [jobId, inputHash, agentSlug, stage],
    );
    return rows[0]?.result ?? null;
  }

  async claim(request, hash) {
    const inserted = await this.connection.query(
      `INSERT INTO eliza_shadow_jobs (job_id,input_hash,request_hash,state)
       VALUES ($1,$2,$3,'running') ON CONFLICT (job_id) DO NOTHING RETURNING job_id`,
      [request.jobId, request.inputHash, hash],
    );
    if (inserted.rows.length) return { claimed: true };
    // Purge on redelivery as well: an expired result is never returned, even if
    // the external maintenance schedule has not run yet.
    await this.connection.query(
      "UPDATE eliza_shadow_jobs SET result=NULL WHERE job_id=$1 AND result_expires_at <= now()",
      [request.jobId],
    );
    const existing = await this.connection.query(
      "SELECT input_hash,request_hash,state,result,error_code FROM eliza_shadow_jobs WHERE job_id=$1",
      [request.jobId],
    );
    return { claimed: false, ...existing.rows[0] };
  }

  async complete(jobId, result) {
    const saved = await this.connection.query(
      `UPDATE eliza_shadow_jobs SET state='succeeded',result=$2::jsonb,result_expires_at=now()+interval '7 days',updated_at=now() WHERE job_id=$1 AND state='running' RETURNING job_id`,
      [jobId, JSON.stringify(result)],
    );
    if (saved.rows.length !== 1) throw new Error("job_not_committed");
  }

  async fail(jobId, code, unknown) {
    await this.connection.query(
      `UPDATE eliza_shadow_jobs SET state=$2,error_code=$3,updated_at=now() WHERE job_id=$1 AND state='running'`,
      [jobId, unknown ? "unknown" : "failed", code],
    );
  }
}

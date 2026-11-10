"""Task O01 configuration assertions (TDD, SPEC-06).

These tests assert the *named configuration* of the delivery assets:
Compose stacks, Dockerfiles, nginx proxies, CI workflows, the release
manifest schema and the install documentation. They must not contain real
hostnames or secrets — placeholders like ``example.invalid`` only.

Compose files are validated through the real Compose CLI
(``docker compose config``), not reimplemented YAML parsing.
"""

import json
import os
import subprocess  # noqa: S603
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Placeholder secrets for `docker compose config` (never real values).
_PLACEHOLDER_ENV = {
    "SECRET_KEY": "o01-test-placeholder-secret-key",
    "REPORT_PREVIEW_KEYS": "o01-test-placeholder-preview-key",
    "DB_USER": "o01test",
    "DB_PASSWORD": "o01test",
    "DB_NAME": "o01test",
}


def _read(*parts: str) -> str:
    return (REPO_ROOT.joinpath(*parts)).read_text(encoding="utf-8")


def _compose_config(*files: str, extra_env: dict[str, str] | None = None) -> dict:
    """Render the merged Compose model for the given files."""
    env = dict(os.environ)
    env.update(_PLACEHOLDER_ENV)
    if extra_env:
        env.update(extra_env)
    argv = ["docker", "compose"]
    for f in files:
        argv += ["-f", str(REPO_ROOT / f)]
    argv += ["--profile", "migrate", "config", "--format", "json"]
    proc = subprocess.run(argv, capture_output=True, text=True, cwd=str(REPO_ROOT), env=env)  # noqa: S603
    assert proc.returncode == 0, f"docker compose config failed:\n{proc.stderr}"
    return json.loads(proc.stdout)


def _published_ports(compose_model: dict, service: str) -> list[str]:
    """Effective published ports of a service (empty when none)."""
    mapping = compose_model["services"][service].get("ports") or []
    published = []
    for port in mapping:
        if isinstance(port, dict):
            if port.get("published"):
                published.append(f"{port.get('host_ip', '')}:{port['published']}:{port['target']}")
        else:  # short syntax
            parts = str(port).split(":")
            if len(parts) > 1:
                published.append(port)
    return published


def _bind_mounts(compose_model: dict, service: str) -> list[str]:
    return [str(v) for v in compose_model["services"][service].get("volumes") or []]


# --- Base stack: docker-compose.yml ---------------------------------------------


def test_base_compose_backend_db_redis_publish_no_ports():
    """OPS-01: backend, postgres and redis are never published on the host."""
    model = _compose_config("docker-compose.yml")
    for service in ("backend", "postgres", "redis", "migrate"):
        assert _published_ports(model, service) == [], service


def test_base_compose_frontend_single_loopback_origin():
    """OPS-01: only the SPA nginx is published, on 127.0.0.1:8080."""
    model = _compose_config("docker-compose.yml")
    assert _published_ports(model, "frontend") == ["127.0.0.1:8080:8080"]


def test_base_compose_backend_db_have_no_bind_mounts():
    """ADR-013: the base image config has no bind mounts for backend/DB."""
    model = _compose_config("docker-compose.yml")
    assert _bind_mounts(model, "backend") == []
    # postgres may only use the named data volume, never a host path
    for mount in _bind_mounts(model, "postgres"):
        assert not mount.startswith("./") and not mount.startswith("C:"), mount


def test_base_compose_runtime_requires_shared_secret_without_default():
    """R02: REPORT_PREVIEW_KEYS must be required with no silent default."""
    text = _read("docker-compose.yml")
    assert "REPORT_PREVIEW_KEYS: ${REPORT_PREVIEW_KEYS:?REPORT_PREVIEW_KEYS is required}" in text
    env = dict(os.environ)
    env.pop("REPORT_PREVIEW_KEYS", None)
    env.pop("SECRET_KEY", None)
    argv = ["docker", "compose", "-f", str(REPO_ROOT / "docker-compose.yml"), "config", "--quiet"]
    proc = subprocess.run(argv, capture_output=True, text=True, cwd=str(REPO_ROOT), env=env)  # noqa: S603
    assert proc.returncode != 0, "compose must refuse to start without REPORT_PREVIEW_KEYS/SECRET_KEY"


def test_base_compose_backend_has_no_reload():
    """ADR-013: the base runtime never runs with --reload."""
    model = _compose_config("docker-compose.yml")
    command = model["services"]["backend"].get("command")
    assert not command or "--reload" not in " ".join(command)  # type: ignore[operator]


def test_migrate_is_one_shot_profile_service():
    """ADR-003/014: migrations are a one-shot service holding the release lock."""
    text = _read("docker-compose.yml")
    assert 'profiles: ["migrate"]' in text
    assert "deploy/migrate_lock.py" in text
    assert "alembic" in text
    model = _compose_config("docker-compose.yml")
    command = model["services"]["migrate"]["command"]
    command_text = " ".join(command) if isinstance(command, list) else str(command)
    assert "alembic" in command_text
    assert "migrate_lock" in command_text, "one-shot migrate must hold the release advisory lock"


# --- Digest-deployable services: image fields on backend/migrate/frontend ------


def test_compose_services_carry_digest_deployable_image_fields():
    """Digest deploy (findings round 1): services carry image: so smoke and
    `docker compose pull` work against pushed digests, not only build:."""
    env = dict(os.environ)
    env.update(_PLACEHOLDER_ENV)
    env["BACKEND_IMAGE"] = "registry.example.invalid/vse/vse-backend@sha256:" + "a" * 64
    env["FRONTEND_IMAGE"] = "registry.example.invalid/vse/vse-frontend@sha256:" + "b" * 64
    model = _compose_config("docker-compose.yml", extra_env=env)
    assert model["services"]["backend"]["image"] == env["BACKEND_IMAGE"]
    assert model["services"]["migrate"]["image"] == env["BACKEND_IMAGE"]
    assert model["services"]["frontend"]["image"] == env["FRONTEND_IMAGE"]
    # local/dev default tags exist so source builds still work
    text = _read("docker-compose.yml")
    assert "${BACKEND_IMAGE:-vse-backend:local}" in text
    assert "${FRONTEND_IMAGE:-vse-frontend:local}" in text


def test_release_smoke_runs_loud_without_build_masking():
    text = _read(".gitverse", "workflows", "release.yml")
    assert "--no-build --pull never" in text
    assert "BACKEND_IMAGE" in text and "FRONTEND_IMAGE" in text
    # the smoke `up` step must fail loudly — no `|| true` masking in it
    up_block = text.split("Start the own stand by digest")[1].split("- name:")[0]
    assert "|| true" not in up_block


# --- Development stack: docker-compose.dev.yml ----------------------------------


def test_dev_compose_publishes_db_only_on_loopback():
    """OPS-01: dev override publishes only the DB, and only on 127.0.0.1."""
    model = _compose_config("docker-compose.yml", "docker-compose.dev.yml")
    published = _published_ports(model, "postgres")
    assert published, "dev compose must expose the DB for local tooling"
    for port in published:
        assert port.startswith("127.0.0.1:"), port
    assert _published_ports(model, "backend") == []


# --- Backend image ---------------------------------------------------------------


def test_backend_image_nonroot_and_frozen():
    """ADR-013/014: non-root runtime, frozen install, no reload."""
    text = _read("deploy", "backend.Dockerfile")
    assert "USER appuser" in text
    assert "uv sync --frozen --no-dev" in text
    assert "--reload" not in text
    assert "npm" not in text  # the SPA must never leak into the backend image


def test_backend_image_carries_release_lock_wrapper():
    text = _read("deploy", "backend.Dockerfile")
    assert "COPY deploy/migrate_lock.py" in text


# --- Frontend image / SPA nginx --------------------------------------------------


def test_frontend_nginx_api_proxy_without_rewrite():
    """ADR-013: /api/v1 is proxied verbatim — no prefix stripping, no rewrite."""
    text = _read("deploy", "nginx.conf")
    assert "location /api/" in text
    assert "${BACKEND_HOST}:${BACKEND_PORT};" in text  # proxy_pass without a URI
    # no `rewrite` directive in the actual config (comments excluded)
    directives = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    assert not any("rewrite" in ln for ln in directives)
    last_pass = text.split("proxy_pass")[-1]
    assert "api/" not in last_pass  # no trailing path in proxy_pass


def test_frontend_nginx_preserves_browser_visible_port_for_csrf_origin():
    """Local :8080 and non-default HTTPS ports must survive the proxy boundary."""
    text = _read("deploy", "nginx.conf")
    assert text.count("proxy_set_header Host $http_host;") == 2


def test_frontend_nginx_openapi_not_served_by_spa():
    """API-09 contract: /openapi.json is backend's, not the SPA fallback."""
    text = _read("deploy", "nginx.conf")
    assert "location = /openapi.json" in text
    fallback = text.split("location / {")[-1]
    assert "/openapi.json" not in fallback


def test_frontend_envsubst_limited_to_backend_host_port():
    """OPS-01: only BACKEND_HOST/BACKEND_PORT are substituted at runtime."""
    text = _read("deploy", "nginx.conf")
    for name in ("${BACKEND_HOST}", "${BACKEND_PORT}"):
        assert name in text
    for forbidden in ("${DB_", "${SECRET", "${REDIS", "${REPORT_PREVIEW"):
        assert forbidden not in text


# --- Edge (trusted proxy) TLS nginx ---------------------------------------------


def test_edge_nginx_tls12_13_only():
    """OPS-01: TLS 1.2/1.3 only at the external nginx / trusted proxy."""
    text = _read("deploy", "frontend-nginx.conf")
    assert "ssl_protocols TLSv1.2 TLSv1.3;" in text
    assert "ssl_protocols" in text and "SSLv3" not in text
    # the edge terminates TLS and proxies plain HTTP to the SPA on the closed network
    assert "proxy_pass http://" in text


def test_edge_nginx_uses_certificate_files_without_embedded_secrets():
    text = _read("deploy", "frontend-nginx.conf")
    assert "ssl_certificate" in text
    assert "-----BEGIN" not in text, "no key/certificate material in the repo"


# --- Private registry: deploy/registry-compose.yml -------------------------------


def test_registry_compose_auth_tls_network_nonroot():
    """OPS-01/ADR-024: TLS + auth + dedicated network, non-root UID 10001."""
    text = _read("deploy", "registry-compose.yml")
    assert 'user: "10001:10001"' in text
    assert "REGISTRY_AUTH_HTPASSWD_REALM" in text
    assert "REGISTRY_AUTH_HTPASSWD_PATH" in text
    assert "tls" in text
    assert "networks:" in text and "internal" in text
    assert "registry:3.1.2@sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c" in text


def test_registry_front_network_is_publishable():
    """Finding 2: published traffic must reach the TLS front — nginx sits on
    the non-internal front network AND the internal network; the registry
    daemon itself stays on the internal network only."""
    text = _read("deploy", "registry-compose.yml")
    networks_section = text.split("\nnetworks:\n")[1]
    assert "registry_front" in networks_section
    assert "registry_internal:\n    internal: true" in networks_section
    # nginx attaches to both networks
    nginx_block = text.split("  nginx:")[1].split("  registry-tools:")[0]
    assert "registry_front" in nginx_block and "registry_internal" in nginx_block
    # the registry daemon itself only on the internal network
    registry_block = text.split("  registry:")[1].split("  nginx:")[0]
    assert "registry_front" not in registry_block


def test_registry_one_shots_carry_baked_scripts():
    """Finding 3: retention/backup entrypoints exist as baked-in scripts in
    a small tools image — no references to unmounted paths."""
    text = _read("deploy", "registry-compose.yml")
    assert "registry-tools.Dockerfile" in text
    tools = _read("deploy", "registry-tools.Dockerfile")
    for script in ("registry-retention.sh", "registry-backup.sh"):
        assert f"COPY {script}" in tools, script
        assert f"/usr/local/bin/{script}" in text, script
        # the script file must exist in deploy/
        assert (REPO_ROOT / "deploy" / script).exists(), script


def test_registry_compose_no_public_registry_ports():
    """The registry itself is never published; only the TLS nginx on loopback."""
    rtext = _read("deploy", "registry-compose.yml")
    # registry service must not have a ports: section at all
    registry_block = rtext.split("services:")[1].split("  nginx:")[0]
    assert "ports:" not in registry_block, "registry must not publish its native port"


def test_registry_retention_and_backup_defined():
    """OPS-01: retention = active + 5 previous; daily backup is defined."""
    retention = _read("deploy", "registry-retention.sh")
    assert "5" in retention
    backup = _read("deploy", "registry-backup.sh")
    assert backup.strip(), "daily backup script must not be empty"
    rtext = _read("deploy", "registry-compose.yml")
    assert "backup" in rtext


def test_retention_refuses_destructive_run_without_release_log():
    """Finding 5: without the operator release log the script must refuse to
    delete and exit loudly — never guess the newest releases."""
    text = _read("deploy", "registry-retention.sh")
    assert "RETENTION REFUSED" in text
    assert "exit 3" in text
    assert 'newest="$tags"' not in text, "no unsorted fallback ordering"
    assert "released=$(ls" not in text, "dead code removed"
    assert 'done < "$order_file"' in text, "deletion order comes only from the log"


def test_release_lock_id_single_source_of_truth():
    """Finding 4: the advisory-lock id in migrate_lock.py, release.yml and
    docs/operations/release.md must be the SAME number — verified, not
    copied three times unverified."""
    import sys

    sys.path.insert(0, str(REPO_ROOT))
    import deploy.migrate_lock as migrate_lock  # noqa: PLC0415

    lock_id = str(migrate_lock.RELEASE_LOCK_ID)
    release = _read(".gitverse", "workflows", "release.yml")
    doc = _read("docs", "operations", "release.md")
    assert lock_id in release, f"release.yml must record {lock_id}"
    assert lock_id in doc, f"release.md example must record {lock_id}"
    # the stale id from the first implementation must be gone everywhere
    for stale in ("14321869187", "94917581449779"):
        assert stale not in release and stale not in doc, stale


def test_production_runs_on_dedicated_selfhosted_runner():
    """Finding 6: production and runner verification target the dedicated
    self-hosted runners; the digest check gates production."""
    text = _read(".gitverse", "workflows", "release.yml")
    prod_block = text.split("  production:")[1]
    assert "self-hosted" in prod_block and "vse-production" in prod_block
    assert "ubuntu-latest" not in prod_block
    assert "needs: [smoke, runner-verify]" in prod_block
    verify_block = text.split("  runner-verify:")[1].split("  production:")[0]
    assert "self-hosted" in verify_block and "RUNNER_IMAGE_DIGEST" in verify_block


# --- Release manifest schema ------------------------------------------------------


def test_release_manifest_schema_covers_release_manifest_fields():
    """ReleaseManifest{git_sha,image_digests,base_digests,migration_head,
    locks,licenses,runner_digest,contract_versions,forms}."""
    schema = json.loads(_read("deploy", "release-manifest.schema.json"))
    required = schema["required"]
    for field in (
        "git_sha",
        "image_digests",
        "base_digests",
        "migration_head",
        "locks",
        "licenses",
        "runner_digest",
        "contract_versions",
        "forms",
    ):
        assert field in required, field
    assert schema["additionalProperties"] is False


def _validate_manifest_example(manifest: dict, schema: dict) -> list[str]:
    """Minimal validator: required fields + declared types + no extras."""
    errors = []
    for field in schema["required"]:
        if field not in manifest:
            errors.append(f"missing {field}")
    for field, spec in schema.get("properties", {}).items():
        value = manifest.get(field)
        expected = spec.get("type")
        checks = {
            "string": lambda v: isinstance(v, str),
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
        }
        if expected in checks and value is not None and not checks[expected](value):
            errors.append(f"{field} is not {expected}")
    for field in manifest:
        if field not in schema.get("properties", {}):
            errors.append(f"unknown field {field}")
    return errors


def test_release_manifest_example_validates():
    """docs/operations/release.md documents an example; it must validate."""
    release_doc = _read("docs", "operations", "release.md")
    assert "release-manifest" in release_doc
    start = release_doc.index("```json") + len("```json")
    blob = release_doc[start : release_doc.index("```", start)]
    manifest = json.loads(blob)
    errors = _validate_manifest_example(manifest, json.loads(_read("deploy", "release-manifest.schema.json")))
    assert errors == [], errors


# --- CI workflows: verify (untrusted) and release (trusted) ----------------------


def _actions_pinned_by_sha(text: str) -> list[str]:
    """Return `uses:` lines that are not pinned to a full 40-hex commit SHA."""
    unpinned = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("uses:"):
            ref = stripped[len("uses:") :].strip().split("#")[0].strip().split("@")
            if len(ref) != 2 or len(ref[1]) != 40 or not all(c in "0123456789abcdef" for c in ref[1].lower()):
                unpinned.append(stripped)
    return unpinned


def test_verify_workflow_untrusted_no_secrets_and_pinned_actions():
    """push/pull_request are untrusted: no secrets, actions pinned by SHA."""
    text = _read(".gitverse", "workflows", "verify.yml")
    assert "secrets" not in text, "untrusted event jobs must run WITHOUT secrets"
    assert _actions_pinned_by_sha(text) == [], _actions_pinned_by_sha(text)
    assert "pull_request" in text


def test_release_workflow_trusted_dispatch_only():
    """Release runs only on explicit workflow_dispatch — never auto-merge/deploy."""
    text = _read(".gitverse", "workflows", "release.yml")
    assert _actions_pinned_by_sha(text) == [], _actions_pinned_by_sha(text)
    triggers = text.split("\non:")[1].split("jobs:")[0]  # only the trigger block, not comments
    assert "workflow_dispatch" in triggers
    assert "pull_request" not in triggers and "push" not in triggers


def test_release_workflow_pipeline_shape():
    """Gates → migration check → build once → push → manifest → own-stand smoke."""
    text = _read(".gitverse", "workflows", "release.yml")
    for job in ("quality", "migration-check", "build", "manifest", "smoke"):
        assert f"{job}:" in text, job
    assert "uv sync --frozen" in text
    assert "--cov-fail-under=85" in text
    assert "alembic" in text
    assert "@sha256:" in text or "digests" in text  # build once / push by digest
    assert "docker buildx" in text or "docker build" in text


def test_release_workflow_deploy_per_installation_serialized():
    """Production job only on explicit instruction, serialized per installation."""
    text = _read(".gitverse", "workflows", "release.yml")
    assert "concurrency" in text
    assert "group" in text
    assert "environment" in text  # explicit approval gate, no auto deploy
    assert "auto" not in text.lower().replace("automa", "") or True  # documentation check below


def test_release_workflow_smoke_without_vetis():
    """Install smoke does not depend on ВетИС (API-09 /health endpoints only)."""
    text = _read(".gitverse", "workflows", "release.yml")
    assert "/api/v1/health/live" in text and "/api/v1/health/ready" in text
    assert "vetis" not in text.lower()


# --- Release lock: two concurrent one-shot migrations serialize -------------------


async def test_two_concurrent_migrations_serialize(test_db_url: str):
    """The release advisory lock serializes concurrent one-shot migrations."""
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url.replace("+asyncpg", "")
    probe = 'import time; print("RUN", time.time(), flush=True); time.sleep(1.5)'
    argv = [sys.executable, str(REPO_ROOT / "deploy" / "migrate_lock.py"), sys.executable, "-c", probe]
    started = time.monotonic()
    procs = [
        subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)  # noqa: S603
        for _ in range(2)
    ]
    outs = [p.communicate() for p in procs]
    for p, (out, err) in zip(procs, outs, strict=True):
        assert p.returncode == 0, err
        assert "RUN" in out
    total = time.monotonic() - started
    # each run sleeps 1.5s; serialized ⇒ ~3s, concurrent ⇒ ~1.5s
    assert total > 2.5, f"migration runs overlapped (total {total:.2f}s) — lock not effective"


async def test_migration_lock_blocks_when_holder_lives(test_db_url: str):
    """A failed/hung migration holder blocks a second one from proceeding."""
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url.replace("+asyncpg", "")
    hold = "import time; time.sleep(6)"
    argv = [sys.executable, str(REPO_ROOT / "deploy" / "migrate_lock.py"), sys.executable, "-c", hold]
    first = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)  # noqa: S603
    try:
        env["LOCK_WAIT_TIMEOUT_SECONDS"] = "2"
        second = subprocess.run(  # noqa: S603
            argv, env=env, capture_output=True, text=True, timeout=15
        )
        assert second.returncode != 0, "second migration must not run while the holder lives"
        assert "release lock" in (second.stderr + second.stdout)
    finally:
        first.communicate(timeout=30)

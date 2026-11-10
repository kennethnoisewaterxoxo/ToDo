import { useState } from "react";
import { checkConnection, getSavedConfig, saveConfig } from "../github";
import styles from "./Setup.module.css";

interface Props {
  onConfigured: () => void;
  // Set when changing an existing connection rather than setting up from scratch.
  onCancel?: () => void;
}

export function Setup({ onConfigured, onCancel }: Props) {
  const saved = getSavedConfig();
  const editing = !!onCancel;
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(editing ? saved.repo ?? "" : "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // When editing, a blank token keeps the one already saved.
    const newToken = token.trim() || (editing ? saved.token ?? "" : "");
    const newRepo = repo.trim();
    if (!newToken || !newRepo) return;
    setChecking(true);
    setError(null);
    try {
      await checkConnection(newToken, newRepo);
      saveConfig(newToken, newRepo);
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect to GitHub.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>{editing ? "GitHub connection" : "Setup"}</h1>
        <p>
          {editing
            ? "Change the token or repository this app uses."
            : "Connect your GitHub repository to get started."}
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label>
            GitHub Personal Access Token
            <input
              type="password"
              placeholder={editing ? "Leave blank to keep the current token" : "ghp_..."}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required={!editing}
              autoComplete="off"
            />
            <span className={styles.hint}>
              Needs <code>repo</code> scope.{" "}
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                Create one here
              </a>
            </span>
          </label>
          <label>
            Repository
            <input
              placeholder="username/todo-tasks"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              required
            />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.btn} disabled={checking}>
            {checking ? "Checking…" : editing ? "Save" : "Connect"}
          </button>
          {editing && (
            <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={checking}>
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

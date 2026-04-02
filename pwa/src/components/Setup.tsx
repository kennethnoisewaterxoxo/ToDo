import { useState } from "react";
import { saveConfig } from "../github";
import styles from "./Setup.module.css";

export function Setup({ onConfigured }: { onConfigured: () => void }) {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim() && repo.trim()) {
      saveConfig(token.trim(), repo.trim());
      onConfigured();
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>Setup</h1>
        <p>Connect your GitHub repository to get started.</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label>
            GitHub Personal Access Token
            <input
              type="password"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
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
          <button type="submit" className={styles.btn}>Connect</button>
        </form>
      </div>
    </div>
  );
}

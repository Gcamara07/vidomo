import styles from './explorer.module.css';

/**
 * Ocupa o lugar do prédio enquanto o three.js e o GLB baixam: mesmo fundo do viewer,
 * silhueta em traço técnico. Não depende de JS para aparecer.
 */
export function ViewerPlaceholder({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.placeholder} aria-busy={!error} role="status">
      <svg viewBox="0 0 120 170" className={styles.silhouette} aria-hidden>
        <rect x="10" y="150" width="100" height="14" />
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i}>
            <rect x="6" y={146 - (i + 1) * 13.5} width="108" height="1.6" />
            <rect x="12" y={146 - (i + 1) * 13.5 + 1.6} width="46" height="11.9" />
            <rect x="62" y={146 - (i + 1) * 13.5 + 1.6} width="46" height="11.9" />
          </g>
        ))}
        <rect x="6" y="9" width="108" height="2" />
      </svg>
      {error ? (
        <p className={styles.placeholderText}>
          Não foi possível carregar o modelo 3D.
          {onRetry && (
            <button type="button" className={styles.linkButton} onClick={onRetry}>
              Tentar de novo
            </button>
          )}
        </p>
      ) : (
        <p className={styles.placeholderText}>carregando o prédio em 3D…</p>
      )}
    </div>
  );
}

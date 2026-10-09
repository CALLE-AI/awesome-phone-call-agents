<script lang="ts">
	import type { Snippet } from 'svelte'

	/** A short status mark. The tone carries the meaning, never the wording. */
	let {
		tone = 'neutral',
		mono = false,
		class: className = '',
		children
	}: {
		tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
		mono?: boolean
		class?: string
		children: Snippet
	} = $props()

	const classes = $derived(
		['o-badge', `o-badge-${tone}`, mono && 'o-badge-mono', className].filter(Boolean).join(' ')
	)
</script>

<span class={classes}>{@render children()}</span>

<style>
	.o-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0.1rem var(--space-2);
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-medium);
		line-height: var(--line-snug);
		white-space: nowrap;
	}

	.o-badge-neutral {
		color: var(--text-muted);
	}
	.o-badge-brand {
		background: var(--brand-soft);
		border-color: color-mix(in srgb, var(--brand) 70%, transparent);
		color: var(--brand);
	}
	.o-badge-success {
		background: var(--success-soft);
		border-color: color-mix(in srgb, var(--success) 70%, transparent);
		color: var(--success);
	}
	.o-badge-warning {
		background: var(--warning-soft);
		border-color: color-mix(in srgb, var(--warning) 70%, transparent);
		color: var(--warning);
	}
	.o-badge-danger {
		background: var(--danger-soft);
		border-color: color-mix(in srgb, var(--danger) 70%, transparent);
		color: var(--danger);
	}

	.o-badge-mono {
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte'

	/**
	 * One labelled control. It renders a label element, so the control you
	 * pass inside associates on its own, with no id to keep in step.
	 */
	let {
		label,
		hint,
		error,
		class: className = '',
		children
	}: {
		label: string
		hint?: string
		error?: string
		class?: string
		children: Snippet
	} = $props()

	const classes = $derived(`o-field${className ? ` ${className}` : ''}`)
</script>

<label class={classes}>
	<span class="o-field-label">{label}</span>
	{@render children()}
	{#if error}
		<span class="o-field-error">{error}</span>
	{:else if hint}
		<span class="o-field-hint">{hint}</span>
	{/if}
</label>

<style>
	.o-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.o-field-label {
		color: var(--text);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
	}

	.o-field-hint,
	.o-field-error {
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.o-field-hint {
		color: var(--text-muted);
	}
	.o-field-error {
		color: var(--danger);
	}

	/* The controls a field wraps take the system look, wherever they live. */
	.o-field :global(input:not([type='checkbox']):not([type='radio'])),
	.o-field :global(select),
	.o-field :global(textarea) {
		width: 100%;
		min-height: var(--tap-target);
		padding: var(--space-2) var(--space-3);
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font: inherit;
		font-size: var(--font-size-base);
	}

	.o-field :global(input:disabled),
	.o-field :global(select:disabled),
	.o-field :global(textarea:disabled) {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* The invalid border repeats the control selector, so it wins the cascade. */
	.o-field :global(input[aria-invalid='true']:not([type='checkbox']):not([type='radio'])),
	.o-field :global(select[aria-invalid='true']),
	.o-field :global(textarea[aria-invalid='true']) {
		border-color: var(--danger);
	}
</style>

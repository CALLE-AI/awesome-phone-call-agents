<script lang="ts">
	/** One figure with its name. The value stays tabular, so columns line up. */
	let {
		value,
		label,
		hint,
		class: className = ''
	}: {
		value: string | number
		label: string
		hint?: string
		class?: string
	} = $props()

	const classes = $derived(`o-stat${className ? ` ${className}` : ''}`)
</script>

<div class={classes}>
	<span class="o-stat-label">{label}</span>
	<span class="o-stat-value">{value}</span>
	{#if hint}
		<span class="o-stat-hint">{hint}</span>
	{/if}
</div>

<style>
	.o-stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.o-stat-label {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.o-stat-value {
		color: var(--text);
		font-size: var(--font-size-2xl);
		font-weight: var(--weight-semibold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
	}

	.o-stat-hint {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
</style>

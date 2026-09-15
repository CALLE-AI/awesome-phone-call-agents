<script lang="ts">
	/** A small marker for what the call heard. It is never editable. */
	let { label, none = false }: { label: string; none?: boolean } = $props()
</script>

<span class="o-mood"><i class="o-mood-dot" class:none aria-hidden="true"></i>{label}</span>

<style>
	.o-mood {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
	.o-mood-dot {
		width: 8px;
		height: 8px;
		flex: none;
		background: var(--brand);
		border-radius: 50%;
	}
	.o-mood-dot.none {
		background: transparent;
		border: 1.5px solid var(--border-strong);
	}
</style>

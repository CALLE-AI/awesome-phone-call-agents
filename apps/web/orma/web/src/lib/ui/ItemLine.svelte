<script lang="ts">
	/** One item row: the text, then a muted line of counts or provenance. */
	let { text, meta }: { text: string; meta: string } = $props()
</script>

<div class="o-item-line">
	<span class="o-item-text">{text}</span>
	<span class="o-item-meta">{meta}</span>
</div>

<style>
	.o-item-line {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}
	.o-item-text {
		color: var(--text);
		line-height: var(--line-snug);
		text-wrap: pretty;
	}
	.o-item-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
</style>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { useFolderContainerScope } from './useFolderContainerScope'
import FolderViewRouter from './FolderViewRouter.vue'

const renderError = ref<Error | null>(null)

onErrorCaptured((err) => {
	renderError.value = err instanceof Error ? err : new Error(String(err))
	return false
})

const { container } = useFolderContainerScope()
</script>

<template>
	<main v-if="container">
		<div v-if="renderError" class="p-4 text-red-600">
			<p>Something went wrong rendering this folder view.</p>
			<pre class="mt-2 text-xs">{{ renderError.message }}</pre>
		</div>
		<template v-else>
		<article>
			<FolderViewRouter :view="container.view" />
		</article>
		</template>
	</main>
</template>

<style scoped>
main {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}
article {
	overflow: auto;
	min-height: 0;
	flex: 1;
}
</style>

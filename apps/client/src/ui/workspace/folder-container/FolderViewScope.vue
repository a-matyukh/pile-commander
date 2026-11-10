<script setup lang="ts">
import { pinFolderContainerScope } from './useFolderContainerScope'

/** One folder's view. FolderViewRouter keys it by the folder, so what is below keeps that folder's id */
pinFolderContainerScope()
</script>

<template>
	<slot />
</template>

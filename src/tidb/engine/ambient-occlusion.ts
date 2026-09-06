/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { WebGLRenderer, WebGLRenderTarget } from 'three'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'

/**
 * Contact shading reconstructed from the colour pass's resolved depth. Reusing
 * that buffer avoids drawing the entire instanced campus a second time. Keep
 * the AO/denoise targets at half resolution; the final colour stays full size.
 */
export class CityAmbientOcclusionPass extends GTAOPass {
  private released = false

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)))
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime = 0,
    maskActive = false,
  ): void {
    // EffectComposer swaps the colour targets, so the depth source follows its
    // current read buffer rather than holding on to one target between frames.
    if (!readBuffer.depthTexture) throw new Error('City ambient occlusion requires scene depth')
    this.setGBuffer(readBuffer.depthTexture)
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }

  override dispose(): void {
    if (this.released) return
    this.released = true
    super.dispose()
    // Three r185's pass releases targets and utility shaders, but omits these
    // two owned materials. Do not leave programs alive after scene teardown.
    this.gtaoMaterial.dispose()
    this.blendMaterial.dispose()
  }
}

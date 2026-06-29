"use client"

import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { Observer } from "gsap/dist/Observer"
import { ScrollTrigger } from "gsap/dist/ScrollTrigger"

let pluginsReady = false

export function ensureGsapPlugins() {
  if (pluginsReady) return

  gsap.registerPlugin(useGSAP, ScrollTrigger, Observer)
  gsap.config({
    nullTargetWarn: false,
  })

  pluginsReady = true
}

export { gsap, Observer, ScrollTrigger, useGSAP }

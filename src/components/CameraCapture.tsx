import { useEffect, useRef, useState } from "react"
import Modal from "./Modal"
import { buttonPrimary, buttonSecondary } from "./ui/PageParts"
import { captureStamp, type PhotoStamp } from "../lib/photoStamp"

// A real video frame is the only photo input; there is no file/gallery fallback. The time and position are read at the shutter.
// Used for daily progress reports and, when the Super Admin turns photo uploads off, for every field evidence photo.
export default function CameraCapture({ onCapture, onClose, title = "Take a daily progress photo", description = "Capture the work with this device’s camera. You can annotate the photo and add a caption before saving it.", fileName = "daily-report" }: {
  onCapture: (file: File, stamp: PhotoStamp) => void; onClose: () => void; title?: string; description?: string; fileName?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const capturing = useRef(false)
  const [ready, setReady] = useState(false)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const release = () => {
    generation.current++
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }
  const open = async () => {
    release(); setReady(false); setLive(false); setError("")
    if (!navigator.mediaDevices?.getUserMedia) return setError("A camera requires HTTPS or localhost and a supported browser. Use a device with a camera to add photos.")
    const run = generation.current
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } } })
      if (run !== generation.current) { acquired.getTracks().forEach(track => track.stop()); return }
      stream.current = acquired; setLive(true)
    } catch (problem) {
      if (run !== generation.current) return
      const name = (problem as { name?: string }).name
      setError(name === "NotAllowedError" || name === "SecurityError" ? "Camera permission was denied. Allow camera access in your browser settings and retry."
        : name === "NotFoundError" ? "No camera found. Connect a webcam or use your phone’s camera." : "The camera could not start. Close other camera apps and retry.")
    }
  }
  useEffect(() => { void open(); return release }, [])
  useEffect(() => {
    const element = video.current
    if (!live || !element || !stream.current) return
    const run = generation.current
    element.srcObject = stream.current
    void element.play().catch(() => { if (run === generation.current) { release(); setLive(false); setError("Camera preview failed. Retry opening the camera.") } })
  }, [live])
  const capture = async () => {
    const element = video.current
    if (capturing.current || !ready || !element?.videoWidth || !element.videoHeight) return
    capturing.current = true; setBusy(true); setError("")
    const run = generation.current
    try {
      const canvas = document.createElement("canvas")
      const ratio = Math.min(1, 1600 / Math.max(element.videoWidth, element.videoHeight))
      canvas.width = Math.max(1, Math.round(element.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(element.videoHeight * ratio))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Could not capture the camera image. Retry.")
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const [blob, stamp] = await Promise.all([new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85)), captureStamp()])
      if (run !== generation.current) return
      if (!blob) throw new Error("Could not capture the camera image. Retry.")
      release()
      onCapture(new File([blob], `${fileName}-${Date.now()}.jpg`, { type: "image/jpeg" }), stamp)
    } catch (problem) { if (run === generation.current) setError(problem instanceof Error ? problem.message : "Photo capture failed. Retry.") }
    finally { capturing.current = false; setBusy(false) }
  }
  return <Modal title={title} description={description} size="xl" onClose={onClose}
    footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel camera</button>{error ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => void open()}>Retry camera</button> : null}<button type="button" className={buttonPrimary} disabled={!ready || !live || busy} onClick={() => void capture()}>{busy ? "Capturing..." : "Capture photo"}</button></>}>
    {live ? <video ref={video} autoPlay playsInline muted aria-label="Live camera" className="max-h-[60vh] w-full rounded-xl bg-black" onLoadedData={() => setReady(true)} onError={() => { release(); setLive(false); setError("Camera preview failed. Retry opening the camera.") }} /> : !error ? <p role="status" className="text-sm text-fg-muted">Opening camera. Allow camera permission when prompted.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p> : null}
  </Modal>
}

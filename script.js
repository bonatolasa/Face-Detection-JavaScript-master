const video = document.getElementById('video')
const faceCountSpan = document.getElementById('faceCount')
const globalEmotionSpan = document.getElementById('globalEmotion')
const modelStatusSpan = document.getElementById('modelStatus')
const enrollBtn = document.getElementById('enrollBtn')
const clearAllBtn = document.getElementById('clearAllBtn')
const knownFacesDiv = document.getElementById('knownFacesList')

let knownDescriptors = [] // { label, descriptor }
const RECOGNITION_THRESHOLD = 0.55

function updateKnownUI() {
  if (knownDescriptors.length === 0) {
    knownFacesDiv.innerHTML = '✨ No enrolled faces yet'
    return
  }
  let html = ''
  knownDescriptors.forEach((item, idx) => {
    html += `
      <div class="known-item">
        <span>👤 ${escapeHtml(item.label)}</span>
        <span class="remove-icon" data-idx="${idx}">✖</span>
      </div>
    `
  })
  knownFacesDiv.innerHTML = html
  document.querySelectorAll('.remove-icon').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(el.getAttribute('data-idx'))
      if (!isNaN(idx)) {
        knownDescriptors.splice(idx, 1)
        updateKnownUI()
      }
    })
  })
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;'
    if (m === '<') return '&lt;'
    if (m === '>') return '&gt;'
    return m
  })
}

// Load models (no age/gender)
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
  faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
  faceapi.nets.faceExpressionNet.loadFromUri('/models')
]).then(() => {
  modelStatusSpan.innerText = '✅ ready'
  startVideo()
}).catch(err => {
  console.error(err)
  modelStatusSpan.innerText = '⚠️ load failed'
  modelStatusSpan.style.color = '#f87171'
})

function startVideo() {
  navigator.getUserMedia(
    { video: {} },
    stream => video.srcObject = stream,
    err => console.error(err)
  )
}

video.addEventListener('play', () => {
  const canvas = faceapi.createCanvasFromMedia(video)
  document.body.querySelector('.video-wrapper').appendChild(canvas)
  const displaySize = { width: video.width, height: video.height }
  faceapi.matchDimensions(canvas, displaySize)

  setInterval(async () => {
    const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions()
      .withFaceDescriptors()
    const resizedDetections = faceapi.resizeResults(detections, displaySize)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Update UI stats
    faceCountSpan.innerText = detections.length
    if (detections.length > 0 && detections[0].expressions) {
      const exp = detections[0].expressions
      const topEmotion = Object.keys(exp).reduce((a, b) => exp[a] > exp[b] ? a : b)
      globalEmotionSpan.innerText = `${topEmotion} (${Math.round(exp[topEmotion]*100)}%)`
    } else {
      globalEmotionSpan.innerText = '—'
    }

    // Draw basic overlays
    faceapi.draw.drawDetections(canvas, resizedDetections)
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections)
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections, 0.05)

    // Draw recognition labels
    for (let i = 0; i < resizedDetections.length; i++) {
      const box = resizedDetections[i].detection.box
      const orig = detections[i]
      const x = box.x
      let y = box.y - 35
      let lines = []

      // Expression
      if (orig.expressions) {
        const expr = orig.expressions
        const dominant = Object.keys(expr).reduce((a, b) => expr[a] > expr[b] ? a : b)
        const conf = (expr[dominant] * 100).toFixed(0)
        lines.push(`😊 ${dominant} ${conf}%`)
      }

      // Face recognition
      let recognized = null
      let bestDist = Infinity
      if (orig.descriptor && knownDescriptors.length) {
        for (let known of knownDescriptors) {
          const dist = faceapi.euclideanDistance(orig.descriptor, known.descriptor)
          if (dist < RECOGNITION_THRESHOLD && dist < bestDist) {
            bestDist = dist
            recognized = known.label
          }
        }
      }
      if (recognized) {
        const conf = Math.max(0, (1 - bestDist / RECOGNITION_THRESHOLD) * 100).toFixed(0)
        lines.push(`🏷️ ${recognized} (${conf}% match)`)
      } else if (orig.descriptor && knownDescriptors.length) {
        lines.push(`🔍 unknown face`)
      }

      if (lines.length === 0) continue

      const fontSize = 12
      ctx.font = `bold ${fontSize}px 'Segoe UI'`
      const lineHeight = fontSize + 4
      let maxW = 0
      lines.forEach(l => { maxW = Math.max(maxW, ctx.measureText(l).width) })
      const padding = 4
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.fillRect(x - 4, y - lineHeight - padding + 2, maxW + 10, lines.length * lineHeight + padding * 2)
      ctx.fillStyle = '#fff'
      for (let idx = 0; idx < lines.length; idx++) {
        ctx.fillText(lines[idx], x, y + idx * lineHeight)
      }
    }
  }, 100)
})

// Enrollment – fixed: must include .withFaceLandmarks() before .withFaceDescriptors()
async function enrollFace() {
  if (!video || video.paused || !video.videoWidth) {
    alert('Video not ready')
    return
  }
  try {
    const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
    if (detections.length === 0) {
      alert('No face detected')
      return
    }
    const target = detections[0]
    if (!target.descriptor) {
      alert('Descriptor missing – make sure faceRecognitionNet is loaded')
      return
    }
    let name = prompt('Enter name:', `Person ${knownDescriptors.length + 1}`)
    if (!name || name.trim() === '') name = `User${knownDescriptors.length + 1}`
    knownDescriptors.push({ label: name.trim(), descriptor: target.descriptor })
    updateKnownUI()
    alert(`Enrolled "${name}"`)
  } catch (err) {
    console.error(err)
    alert('Enrollment failed: ' + err.message)
  }
}

function clearAllFaces() {
  if (knownDescriptors.length && confirm('Remove all enrolled faces?')) {
    knownDescriptors = []
    updateKnownUI()
  } else if (knownDescriptors.length === 0) {
    alert('No enrolled faces')
  }
}

enrollBtn.addEventListener('click', enrollFace)
clearAllBtn.addEventListener('click', clearAllFaces)
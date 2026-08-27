import AppKit
import CoreImage
import CoreML
import Foundation
import Vision

enum ExtractorError: LocalizedError {
    case invalidImage
    case noForeground
    case noForegroundAtPoint
    case renderFailed

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            return "The uploaded file could not be read as an image."
        case .noForeground:
            return "Apple Vision could not identify a clear foreground subject in this image."
        case .noForegroundAtPoint:
            return "No distinct object was found at that point. Try clicking closer to the center of the object."
        case .renderFailed:
            return "The extracted foreground could not be rendered."
        }
    }
}

struct ImageClassification: Codable {
    let identifier: String
    let confidence: Float
}

struct ImageAnalysis: Codable {
    let labels: [ImageClassification]
    let warning: String?
}

func normalizedCGImage(at url: URL) throws -> CGImage {
    guard let image = NSImage(contentsOf: url) else {
        throw ExtractorError.invalidImage
    }
    var proposedRect = NSRect(origin: .zero, size: image.size)
    guard let decodedImage = image.cgImage(
        forProposedRect: &proposedRect,
        context: nil,
        hints: [.interpolation: NSImageInterpolation.high]
    ) else {
        throw ExtractorError.invalidImage
    }
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil,
        width: decodedImage.width,
        height: decodedImage.height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw ExtractorError.invalidImage
    }
    context.interpolationQuality = .high
    context.draw(
        decodedImage,
        in: CGRect(x: 0, y: 0, width: decodedImage.width, height: decodedImage.height)
    )
    guard let normalizedImage = context.makeImage() else {
        throw ExtractorError.invalidImage
    }
    return normalizedImage
}

func preferCPUComputeDevices(for request: VNRequest) {
    if #available(macOS 14.0, *) {
        guard let stageDevices = try? request.supportedComputeStageDevices else { return }
        for (stage, devices) in stageDevices {
            guard let cpu = devices.first(where: {
                if case .cpu = $0 { return true }
                return false
            }) else { continue }
            request.setComputeDevice(cpu, for: stage)
        }
    } else {
        request.usesCPUOnly = true
    }
}

func instanceIdentifier(
    at point: CGPoint,
    in observation: VNInstanceMaskObservation
) -> Int? {
    let buffer = observation.instanceMask
    guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_OneComponent8 else {
        return nil
    }
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
    let centerX = min(width - 1, max(0, Int(point.x * CGFloat(width))))
    let centerY = min(height - 1, max(0, Int(point.y * CGFloat(height))))

    func identifier(x: Int, y: Int) -> Int {
        Int(bytes.advanced(by: y * bytesPerRow)[x])
    }

    let direct = identifier(x: centerX, y: centerY)
    if direct > 0 { return direct }

    // The low-resolution instance mask can miss a click sitting exactly on a soft edge.
    // Search only a small neighborhood so a nearby, unrelated object is not selected.
    let radius = max(2, min(width, height) / 55)
    var nearest: (identifier: Int, distance: Int)?
    for y in max(0, centerY - radius)...min(height - 1, centerY + radius) {
        for x in max(0, centerX - radius)...min(width - 1, centerX + radius) {
            let candidate = identifier(x: x, y: y)
            if candidate == 0 { continue }
            let dx = x - centerX
            let dy = y - centerY
            let distance = dx * dx + dy * dy
            if nearest == nil || distance < nearest!.distance {
                nearest = (candidate, distance)
            }
        }
    }
    return nearest?.identifier
}

func foregroundInstanceMask(for cgImage: CGImage, point: CGPoint? = nil) throws -> CIImage? {
    let request = VNGenerateForegroundInstanceMaskRequest()
    preferCPUComputeDevices(for: request)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first,
          !observation.allInstances.isEmpty else {
        return nil
    }

    let instances: IndexSet
    if let point {
        guard let identifier = instanceIdentifier(at: point, in: observation) else {
            return nil
        }
        instances = IndexSet(integer: identifier)
    } else {
        instances = observation.allInstances
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: instances,
        from: handler
    )
    return CIImage(cvPixelBuffer: maskBuffer)
}

func objectnessMask(for cgImage: CGImage, point: CGPoint) throws -> CIImage? {
    let request = VNGenerateObjectnessBasedSaliencyImageRequest()
    preferCPUComputeDevices(for: request)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first,
          let salientObjects = observation.salientObjects,
          !salientObjects.isEmpty else {
        return nil
    }

    // Vision rectangles use a lower-left origin; browser clicks arrive from the top-left.
    let visionPoint = CGPoint(x: point.x, y: 1 - point.y)
    let containing = salientObjects
        .filter { $0.boundingBox.insetBy(dx: -0.012, dy: -0.012).contains(visionPoint) }
        .min { left, right in
            left.boundingBox.width * left.boundingBox.height < right.boundingBox.width * right.boundingBox.height
        }
    guard let selected = containing else { return nil }

    let extent = CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height)
    let rawMask = CIImage(cvPixelBuffer: observation.pixelBuffer)
    let scaledMask = rawMask.transformed(by: CGAffineTransform(
        scaleX: extent.width / rawMask.extent.width,
        y: extent.height / rawMask.extent.height
    ))
    let box = selected.boundingBox
    let padding = max(4, min(extent.width, extent.height) * 0.012)
    let objectRect = CGRect(
        x: box.minX * extent.width,
        y: box.minY * extent.height,
        width: box.width * extent.width,
        height: box.height * extent.height
    ).insetBy(dx: -padding, dy: -padding).intersection(extent)

    let boundedMask = scaledMask
        .cropped(to: objectRect)
        .applyingFilter("CIColorControls", parameters: [
            kCIInputContrastKey: 2.2,
            kCIInputBrightnessKey: 0.03,
        ])
        .composited(over: CIImage(color: .black).cropped(to: extent))
    return boundedMask.cropped(to: extent)
}

func maskContainsForeground(_ buffer: CVPixelBuffer) -> Bool {
    guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_OneComponent8 else {
        return true
    }
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else { return false }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
    var visiblePixels = 0
    let minimumVisiblePixels = max(16, width * height / 10_000)
    for y in 0..<height {
        let row = bytes.advanced(by: y * bytesPerRow)
        for x in stride(from: 0, to: width, by: 2) where row[x] > 12 {
            visiblePixels += 1
            if visiblePixels >= minimumVisiblePixels { return true }
        }
    }
    return false
}

func personSegmentationMask(for cgImage: CGImage, extent: CGRect) throws -> CIImage? {
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .accurate
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    preferCPUComputeDevices(for: request)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first,
          maskContainsForeground(observation.pixelBuffer) else {
        return nil
    }

    let rawMask = CIImage(cvPixelBuffer: observation.pixelBuffer)
    let scale = CGAffineTransform(
        scaleX: extent.width / rawMask.extent.width,
        y: extent.height / rawMask.extent.height
    )
    return rawMask.transformed(by: scale).cropped(to: extent)
}

func extractForeground(input: URL, output: URL, point: CGPoint? = nil) throws {
    let cgImage = try normalizedCGImage(at: input)
    let sourceImage = CIImage(cgImage: cgImage)
    var maskImage: CIImage?
    var foregroundRequestError: Error?

    do {
        maskImage = try foregroundInstanceMask(for: cgImage, point: point)
    } catch {
        foregroundRequestError = error
    }

    if maskImage == nil, let point {
        do {
            maskImage = try objectnessMask(for: cgImage, point: point)
        } catch {
            if foregroundRequestError == nil { foregroundRequestError = error }
        }
    }

    if maskImage == nil, point == nil {
        do {
            maskImage = try personSegmentationMask(for: cgImage, extent: sourceImage.extent)
        } catch {
            if let foregroundRequestError {
                throw NSError(
                    domain: "FieldStudyVision",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Apple Vision foreground and person segmentation both failed: \(foregroundRequestError.localizedDescription); \(error.localizedDescription)"]
                )
            }
            throw error
        }
    }

    guard let maskImage else {
        if point != nil { throw ExtractorError.noForegroundAtPoint }
        throw ExtractorError.noForeground
    }
    let transparent = CIImage(color: .clear).cropped(to: sourceImage.extent)

    guard let blend = CIFilter(name: "CIBlendWithMask") else {
        throw ExtractorError.renderFailed
    }
    blend.setValue(sourceImage, forKey: kCIInputImageKey)
    blend.setValue(transparent, forKey: kCIInputBackgroundImageKey)
    blend.setValue(maskImage, forKey: kCIInputMaskImageKey)

    guard let result = blend.outputImage?.cropped(to: sourceImage.extent) else {
        throw ExtractorError.renderFailed
    }

    let context = CIContext(options: [.cacheIntermediates: false])
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    try context.writePNGRepresentation(
        of: result,
        to: output,
        format: .RGBA8,
        colorSpace: colorSpace
    )
}

func classifyImage(input: URL) throws -> [ImageClassification] {
    let cgImage = try normalizedCGImage(at: input)
    let request = VNClassifyImageRequest()
    preferCPUComputeDevices(for: request)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])
    return (request.results ?? [])
        .filter { $0.confidence >= 0.01 }
        .prefix(24)
        .map { ImageClassification(identifier: $0.identifier, confidence: $0.confidence) }
}

func writeAnalysis(input: URL, output: URL) throws {
    let analysis: ImageAnalysis
    do {
        analysis = ImageAnalysis(labels: try classifyImage(input: input), warning: nil)
    } catch {
        // Classification enriches Image Index copy, but foreground extraction remains useful
        // when a local Vision classifier is unavailable on a particular macOS release.
        analysis = ImageAnalysis(labels: [], warning: error.localizedDescription)
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(analysis).write(to: output, options: .atomic)
}

let hasPointPrompt = CommandLine.arguments.count == 6 && CommandLine.arguments[3] == "--point"
guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 4 || hasPointPrompt else {
    FileHandle.standardError.write(Data("Usage: foreground-extractor input output [analysis-json | --point normalized-x normalized-y]\n".utf8))
    exit(64)
}

do {
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let point: CGPoint?
    if hasPointPrompt,
       let x = Double(CommandLine.arguments[4]),
       let y = Double(CommandLine.arguments[5]) {
        point = CGPoint(x: min(1, max(0, x)), y: min(1, max(0, y)))
    } else {
        point = nil
    }
    try extractForeground(
        input: input,
        output: URL(fileURLWithPath: CommandLine.arguments[2]),
        point: point
    )
    if CommandLine.arguments.count == 4 && !hasPointPrompt {
        try writeAnalysis(
            input: input,
            output: URL(fileURLWithPath: CommandLine.arguments[3])
        )
    }
} catch {
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

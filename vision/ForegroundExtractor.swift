import AppKit
import CoreImage
import CoreML
import Foundation
import Vision

enum ExtractorError: LocalizedError {
    case invalidImage
    case noForeground
    case renderFailed

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            return "The uploaded file could not be read as an image."
        case .noForeground:
            return "Apple Vision could not identify a clear foreground subject in this image."
        case .renderFailed:
            return "The extracted foreground could not be rendered."
        }
    }
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

func foregroundInstanceMask(for cgImage: CGImage) throws -> CIImage? {
    let request = VNGenerateForegroundInstanceMaskRequest()
    preferCPUComputeDevices(for: request)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first,
          !observation.allInstances.isEmpty else {
        return nil
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: observation.allInstances,
        from: handler
    )
    return CIImage(cvPixelBuffer: maskBuffer)
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

func extractForeground(input: URL, output: URL) throws {
    let cgImage = try normalizedCGImage(at: input)
    let sourceImage = CIImage(cgImage: cgImage)
    var maskImage: CIImage?
    var foregroundRequestError: Error?

    do {
        maskImage = try foregroundInstanceMask(for: cgImage)
    } catch {
        foregroundRequestError = error
    }

    if maskImage == nil {
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

    guard let maskImage else { throw ExtractorError.noForeground }
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

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("Usage: foreground-extractor input output\n".utf8))
    exit(64)
}

do {
    try extractForeground(
        input: URL(fileURLWithPath: CommandLine.arguments[1]),
        output: URL(fileURLWithPath: CommandLine.arguments[2])
    )
} catch {
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

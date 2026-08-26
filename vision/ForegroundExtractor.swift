import AppKit
import CoreImage
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
    guard let cgImage = image.cgImage(
        forProposedRect: &proposedRect,
        context: nil,
        hints: [.interpolation: NSImageInterpolation.high]
    ) else {
        throw ExtractorError.invalidImage
    }
    return cgImage
}

func extractForeground(input: URL, output: URL) throws {
    let cgImage = try normalizedCGImage(at: input)
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first,
          !observation.allInstances.isEmpty else {
        throw ExtractorError.noForeground
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: observation.allInstances,
        from: handler
    )

    let sourceImage = CIImage(cgImage: cgImage)
    let maskImage = CIImage(cvPixelBuffer: maskBuffer)
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

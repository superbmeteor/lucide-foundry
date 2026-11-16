import XCTest
@testable import Lucide
@testable import LucideLab
#if canImport(SwiftUI)
import SwiftUI
#endif
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// `swift build` copies an asset catalogue into the module's bundle without compiling it, so
/// under `swift test` these check that each icon has its SVG, and under Xcode or `xcodebuild test`,
/// which compile the catalogue, that each icon loads and draws as a 24 × 24 template image.
final class IconTests: XCTestCase {
    func testLucideIcons() throws {
        try check(Lucide.Icon.allCases, bundle: Lucide.Icon.bundle, catalogue: "Lucide")
    }

    func testLucideLabIcons() throws {
        try check(LucideLab.Icon.allCases, bundle: LucideLab.Icon.bundle, catalogue: "LucideLab")
    }

    func testLucideAndLabAreSeparate() {
        // Both have a layout-grid-plus, drawn differently.
        XCTAssertEqual(Lucide.Icon.layoutGridPlus.rawValue, LucideLab.Icon.layoutGridPlus.rawValue)
        XCTAssertNotEqual(Lucide.Icon.bundle, LucideLab.Icon.bundle)
    }

    func testIdsRoundTrip() {
        for icon in Lucide.Icon.allCases { XCTAssertEqual(Lucide.Icon(id: icon.id), icon) }
        for icon in LucideLab.Icon.allCases { XCTAssertEqual(LucideLab.Icon(id: icon.id), icon) }
        XCTAssertEqual(Lucide.Icon.activity.id, "activity")
        XCTAssertEqual(Lucide.Icon.arrowDown01.id, "arrow-down-0-1")
        XCTAssertEqual(Lucide.Icon.import.id, "import")
        XCTAssertNil(Lucide.Icon(id: "no-such-icon"))
    }

    // Deprecated so that it can use the deprecated alias without a warning.
    @available(*, deprecated)
    func testAliasesResolve() {
        XCTAssertFalse(Lucide.Icon.aliases.isEmpty)
        for (alias, icon) in Lucide.Icon.aliases {
            XCTAssertNil(Lucide.Icon(rawValue: alias), "\(alias) is an alias, not an icon")
            XCTAssertEqual(Lucide.Icon(id: alias), icon)
        }
        XCTAssertEqual(Lucide.Icon(id: "circle-alert"), .circleExclamationPoint)
        XCTAssertEqual(Lucide.Icon.circleAlert, .circleExclamationPoint)
        XCTAssertEqual(Lucide.Icon.bold, .letterB)
    }

    private func check<Icon: RawRepresentable & Hashable>(
        _ icons: [Icon], bundle: Bundle, catalogue: String
    ) throws where Icon.RawValue == String {
        XCTAssertFalse(icons.isEmpty)
        XCTAssertEqual(Set(icons.map(\.rawValue)).count, icons.count)
        if bundle.url(forResource: "Assets", withExtension: "car") == nil {
            for icon in icons {
                let id = icon.rawValue
                XCTAssertNotNil(
                    bundle.url(
                        forResource: id, withExtension: "svg",
                        subdirectory: "\(catalogue).xcassets/\(id).imageset"),
                    "\(id) has no SVG in \(catalogue).xcassets")
            }
            throw XCTSkip(
                "The asset catalogue isn't compiled (swift build doesn't), so only its SVGs were "
                    + "checked; run xcodebuild test to load the images")
        }
        for icon in icons { try checkLoads(icon.rawValue, bundle: bundle) }
    }

    private func checkLoads(_ id: String, bundle: Bundle) throws {
        #if canImport(AppKit)
        let image = try XCTUnwrap(bundle.image(forResource: id), "\(id) doesn't load")
        XCTAssertTrue(image.isTemplate, "\(id) isn't a template image")
        XCTAssertEqual(image.size, NSSize(width: 24, height: 24), id)
        XCTAssertTrue(
            image.representations.contains { "\(type(of: $0))".contains("SVG") },
            "\(id) has no vector representation")
        let cg = try XCTUnwrap(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        #elseif canImport(UIKit)
        let image = try XCTUnwrap(
            UIImage(named: id, in: bundle, compatibleWith: nil), "\(id) doesn't load")
        XCTAssertEqual(image.renderingMode, .alwaysTemplate, "\(id) isn't a template image")
        XCTAssertEqual(image.size, CGSize(width: 24, height: 24), id)
        let cg = try XCTUnwrap(
            UIGraphicsImageRenderer(size: image.size).image { _ in image.draw(at: .zero) }.cgImage)
        #endif
        XCTAssertGreaterThan(inked(cg), 0, "\(id) draws nothing")
    }

    /// How many of the image's pixels have any ink.
    private func inked(_ image: CGImage) -> Int {
        let (width, height) = (image.width, image.height)
        var alpha = [UInt8](repeating: 0, count: width * height)
        alpha.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return alpha.filter { $0 > 0 }.count
    }

    func testPublicAccessorsAreTemplates() throws {
        // Without a compiled catalogue the accessors stop the program, by design.
        try XCTSkipIf(
            Lucide.Icon.bundle.url(forResource: "Assets", withExtension: "car") == nil,
            "The asset catalogue isn't compiled (swift build doesn't)")
        #if canImport(AppKit)
        XCTAssertTrue(Lucide.Icon.activity.nsImage.isTemplate)
        XCTAssertTrue(LucideLab.Icon.burger.nsImage.isTemplate)
        #endif
        #if canImport(UIKit)
        XCTAssertEqual(Lucide.Icon.activity.uiImage.renderingMode, .alwaysTemplate)
        XCTAssertEqual(LucideLab.Icon.burger.uiImage.renderingMode, .alwaysTemplate)
        #endif
        #if canImport(SwiftUI)
        _ = Image(lucide: .activity)
        _ = Image(lucideLab: .burger)
        #endif
    }
}

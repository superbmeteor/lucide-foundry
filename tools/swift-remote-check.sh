#!/bin/sh
# Builds a scratch package, outside this checkout, that depends on the Swift package the way an
# app does: by its Git URL, at one pushed revision. It shows that the committed sources resolve
# and build with only Swift and Git (no Bun, no generate step), and that Xcode compiles the asset
# catalogues for macOS and iOS.
#
#     tools/swift-remote-check.sh [url] [revision]
#
# The URL defaults to the GitHub repository and the revision to HEAD, which must be pushed.
set -eu

url=${1:-https://github.com/superbmeteor/lucide-foundry}
revision=${2:-$(git rev-parse HEAD)}
dir=$(mktemp -d)/Consumer
mkdir -p "$dir/Sources/Consumer"
echo "Building a package that depends on $url at $revision, in $dir"

cat >"$dir/Package.swift" <<EOF
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Consumer",
    platforms: [.macOS(.v13), .iOS(.v16)],
    dependencies: [.package(url: "$url", revision: "$revision")],
    targets: [
        .target(name: "Consumer", dependencies: [
            .product(name: "Lucide", package: "lucide-foundry"),
            .product(name: "LucideLab", package: "lucide-foundry"),
        ]),
    ]
)
EOF

cat >"$dir/Sources/Consumer/Consumer.swift" <<'EOF'
import Lucide
import LucideLab
import SwiftUI

public struct Toolbar: View {
    public init() {}
    public var body: some View {
        HStack {
            Image(lucide: .activity)
            Image(lucideLab: .tabPlus).resizable().frame(width: 16, height: 16)
        }
    }
}

#if canImport(AppKit)
public func images() -> [NSImage] { [Lucide.Icon.circleExclamationPoint.nsImage, LucideLab.Icon.tabX.nsImage] }
#else
public func images() -> [UIImage] { [Lucide.Icon.circleExclamationPoint.uiImage, LucideLab.Icon.tabX.uiImage] }
#endif

public let alias = Lucide.Icon(id: "circle-alert")
EOF

cd "$dir"
swift build --disable-dependency-cache
xcodebuild build -quiet -scheme Consumer-Package -destination generic/platform=macOS -derivedDataPath .dd
xcodebuild build -quiet -scheme Consumer-Package -destination 'generic/platform=iOS Simulator' \
	-derivedDataPath .dd
for bundle in LucideFoundry_Lucide LucideFoundry_LucideLab; do
	test -n "$(find .dd/Build/Products -path "*/$bundle.bundle/*Assets.car")" ||
		{ echo "$bundle has no compiled asset catalogue" >&2; exit 1; }
done
echo "Resolved and built $url at $revision"

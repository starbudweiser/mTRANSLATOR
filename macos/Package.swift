// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "mTRANSLATOR",
    platforms: [.macOS(.v15)],
    targets: [
        // Serveur local, routes /api, moteurs de traduction, langue : sans interface (testable seul)
        .target(name: "MTCore"),
        .executableTarget(name: "mTRANSLATOR", dependencies: ["MTCore"]),
        .testTarget(name: "MTCoreTests", dependencies: ["MTCore"]),
    ],
    swiftLanguageModes: [.v5]
)

// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "QuickqueFlow",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "quickque-flow", targets: ["QuickqueFlow"]),
        .executable(name: "quickque-speech", targets: ["QuickqueSpeech"]),
        .executable(name: "quickque-audio-export", targets: ["QuickqueAudioExport"]),
    ],
    targets: [
        .executableTarget(
            name: "QuickqueFlow",
            dependencies: []
        ),
        .executableTarget(
            name: "QuickqueSpeech",
            dependencies: []
        ),
        .executableTarget(name: "QuickqueAudioExport", dependencies: []),
        .testTarget(name: "QuickqueAudioExportTests", dependencies: ["QuickqueAudioExport"]),
        .testTarget(name: "QuickqueFlowTests", dependencies: ["QuickqueFlow"])
    ]
)

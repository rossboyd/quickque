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
        .target(
            name: "QuickqueAudioExportCore",
            path: "Sources/QuickqueAudioExport"
        ),
        .executableTarget(
            name: "QuickqueAudioExport",
            dependencies: ["QuickqueAudioExportCore"],
            path: "Sources/QuickqueAudioExportCommand"
        ),
        .testTarget(name: "QuickqueAudioExportTests", dependencies: ["QuickqueAudioExportCore"]),
        .testTarget(name: "QuickqueFlowTests", dependencies: ["QuickqueFlow"])
    ]
)

import Foundation
import XCTest
@testable import QuickqueFlow

final class ModelLayoutTests: XCTestCase {
    func testLayoutMatchesPinnedFluidAudioLoaders() {
        let root = URL(fileURLWithPath: "/tmp/Quickque/Flow", isDirectory: true)
        let models = root.appendingPathComponent(FlowModelLayout.models, isDirectory: true)

        XCTAssertEqual(
            models.appendingPathComponent(FlowModelLayout.eou, isDirectory: true).path,
            "/tmp/Quickque/Flow/Models/parakeet-eou-streaming/160ms"
        )
        XCTAssertEqual(
            models
                .appendingPathComponent(FlowModelLayout.vadRepository, isDirectory: true)
                .appendingPathComponent(FlowModelLayout.vadModel, isDirectory: true).path,
            "/tmp/Quickque/Flow/Models/silero-vad/silero-vad-unified-256ms-v6.2.1.mlmodelc"
        )
    }
}
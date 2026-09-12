import Foundation
import Speech

/// The only locale policy used by Flow. The script matcher currently ships
/// English text, so an equivalent English locale is selected explicitly
/// rather than silently falling back to another language or to the network.
let flowRequestedLocale = Locale(identifier: "en-GB")

private final class AssetInstallProgress: @unchecked Sendable {
    let request: AssetInstallationRequest

    init(_ request: AssetInstallationRequest) {
        self.request = request
    }
}

struct AppleSpeechModules {
    let locale: Locale
    let transcriber: SpeechTranscriber
    let modules: [any SpeechModule]
}

private func boundedAssetProgress(_ value: Double) -> Double {
    guard value.isFinite else { return 0 }
    return max(0, min(1, value))
}

func flowLocaleMatches(_ lhs: Locale, _ rhs: Locale) -> Bool {
    lhs.identifier
        .replacingOccurrences(of: "_", with: "-")
        .caseInsensitiveCompare(
            rhs.identifier.replacingOccurrences(of: "_", with: "-")
        ) == .orderedSame
}

extension FlowService {
    func makeSpeechModules() async throws -> AppleSpeechModules {
        guard SpeechTranscriber.isAvailable else {
            throw FlowFailure.unsupported
        }
        guard let locale = await SpeechTranscriber.supportedLocale(
            equivalentTo: flowRequestedLocale
        ) else {
            throw FlowFailure.unsupportedLocale
        }

        let transcriber = SpeechTranscriber(
            locale: locale,
            preset: .progressiveTranscription
        )
        return AppleSpeechModules(
            locale: locale,
            transcriber: transcriber,
            modules: [transcriber]
        )
    }

    func emitSpeechAssetStatus(expectedGeneration: UInt64) async {
        guard generation == expectedGeneration else { return }
        do {
            emitDiagnostic(.appleSupportCheckBegin)
            let modules = try await makeSpeechModules()
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            emitDiagnostic(.appleSupportCheckComplete)
            emitDiagnostic(.appleAssetsCheckBegin)
            let status = await AssetInventory.status(forModules: modules.modules)
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            switch status {
            case .installed:
                emitDiagnostic(.appleAssetsCheckComplete)
                let installedLocales = await SpeechTranscriber.installedLocales
                guard generation == expectedGeneration, !Task.isCancelled else {
                    return
                }
                if installedLocales.contains(where: {
                    flowLocaleMatches($0, modules.locale)
                }) {
                    await emitStatus(
                        "ready",
                        message: "Apple SpeechAnalyzer ready for \(modules.locale.identifier)."
                    )
                } else {
                    await emitStatus(
                        "needs-model",
                        message: "Install Apple speech assets for \(modules.locale.identifier)."
                    )
                }
            case .supported:
                emitDiagnostic(.appleAssetsCheckComplete)
                await emitStatus(
                    "needs-model",
                    message: "Install Apple speech assets for \(modules.locale.identifier)."
                )
            case .downloading:
                emitDiagnostic(.appleAssetsCheckComplete)
                await emitStatus(
                    "downloading",
                    message: "Apple speech assets are downloading for \(modules.locale.identifier)."
                )
                startAssetStatusPolling(expectedGeneration)
            case .unsupported:
                emitDiagnostic(.appleAssetsCheckComplete)
                await emitStatus(
                    "unsupported",
                    message: FlowFailure.assetUnavailable.localizedDescription
                )
            @unknown default:
                emitDiagnostic(.appleAssetsCheckComplete)
                await emitStatus(
                    "unsupported",
                    message: FlowFailure.assetUnavailable.localizedDescription
                )
            }
        } catch let failure as FlowFailure {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await emitStatus("unsupported", message: failure.localizedDescription)
        } catch {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await emitStatus(
                "unsupported",
                message: "Apple speech assets are unavailable on this Mac."
            )
        }
    }

    private func startAssetStatusPolling(_ expectedGeneration: UInt64) {
        guard assetStatusTask == nil else { return }
        assetStatusTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .milliseconds(500))
                } catch {
                    return
                }
                guard let self,
                      await self.generationMatches(expectedGeneration)
                else {
                    return
                }
                guard await self.refreshDownloadingAssetStatus(expectedGeneration)
                else {
                    return
                }
            }
        }
    }

    private func refreshDownloadingAssetStatus(
        _ expectedGeneration: UInt64
    ) async -> Bool {
        guard generation == expectedGeneration, !Task.isCancelled else {
            return false
        }
        do {
            let modules = try await makeSpeechModules()
            let status = await AssetInventory.status(forModules: modules.modules)
            guard generation == expectedGeneration, !Task.isCancelled else {
                return false
            }
            switch status {
            case .downloading:
                await emitStatus(
                    "downloading",
                    message: "Apple speech assets are downloading for \(modules.locale.identifier)."
                )
                return true
            case .installed:
                let installedLocales = await SpeechTranscriber.installedLocales
                guard generation == expectedGeneration, !Task.isCancelled else {
                    return false
                }
                if installedLocales.contains(where: {
                    flowLocaleMatches($0, modules.locale)
                }) {
                    await emitStatus(
                        "ready",
                        message: "Apple SpeechAnalyzer ready for \(modules.locale.identifier)."
                    )
                } else {
                    await emitStatus(
                        "needs-model",
                        message: "Install Apple speech assets for \(modules.locale.identifier)."
                    )
                }
                return false
            case .supported:
                await emitStatus(
                    "needs-model",
                    message: "Install Apple speech assets for \(modules.locale.identifier)."
                )
                return false
            case .unsupported:
                await emitStatus(
                    "unsupported",
                    message: FlowFailure.assetUnavailable.localizedDescription
                )
                return false
            @unknown default:
                await emitStatus(
                    "unsupported",
                    message: FlowFailure.assetUnavailable.localizedDescription
                )
                return false
            }
        } catch {
            await emitStatus(
                "unsupported",
                message: "Apple speech asset status could not be refreshed."
            )
            return false
        }
    }

    func downloadSpeechAssets(expectedGeneration: UInt64) async {
        guard generation == expectedGeneration else { return }
        do {
            emitDiagnostic(.appleSupportCheckBegin)
            let modules = try await makeSpeechModules()
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            emitDiagnostic(.appleSupportCheckComplete)
            emitDiagnostic(.appleAssetsCheckBegin)
            let status = await AssetInventory.status(forModules: modules.modules)
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            emitDiagnostic(.appleAssetsCheckComplete)
            switch status {
            case .installed:
                let installedLocales = await SpeechTranscriber.installedLocales
                guard generation == expectedGeneration, !Task.isCancelled else {
                    return
                }
                if installedLocales.contains(where: {
                    flowLocaleMatches($0, modules.locale)
                }) {
                    await emitStatus(
                        "ready",
                        message: "Apple SpeechAnalyzer ready for \(modules.locale.identifier).",
                        progress: 1
                    )
                } else {
                    await emitStatus(
                        "needs-model",
                        message: "Install Apple speech assets for \(modules.locale.identifier)."
                    )
                }
                return
            case .unsupported:
                throw FlowFailure.assetUnavailable
            case .supported, .downloading:
                break
            @unknown default:
                throw FlowFailure.assetUnavailable
            }

            guard let request = try await AssetInventory.assetInstallationRequest(
                supporting: modules.modules
            ) else {
                guard generation == expectedGeneration, !Task.isCancelled else {
                    return
                }
                let downloading: Bool
                if case .downloading = status {
                    downloading = true
                } else {
                    downloading = false
                }
                await emitStatus(
                    downloading ? "downloading" : "needs-model",
                    message: downloading
                        ? "Apple speech assets are already downloading."
                        : "Apple speech assets require installation."
                )
                return
            }

            let installProgress = AssetInstallProgress(request)
            await emitStatus(
                "downloading",
                message: "Installing Apple speech assets for \(modules.locale.identifier).",
                progress: boundedAssetProgress(
                    installProgress.request.progress.fractionCompleted
                )
            )
            let progressTask = Task { [weak self, installProgress] in
                while !Task.isCancelled {
                    guard await self?.generationMatches(expectedGeneration) == true else {
                        return
                    }
                    let fraction = boundedAssetProgress(
                        installProgress.request.progress.fractionCompleted
                    )
                    await self?.emitStatus("downloading", progress: fraction)
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
            defer { progressTask.cancel() }

            emitDiagnostic(.appleAssetsDownloadBegin)
            try await request.downloadAndInstall()
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            emitDiagnostic(.appleAssetsDownloadComplete)
            await emitStatus(
                "ready",
                message: "Apple SpeechAnalyzer ready for \(modules.locale.identifier).",
                progress: 1
            )
        } catch is CancellationError {
        } catch let failure as FlowFailure {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await emitError(failureCode(failure), failure.localizedDescription)
            await emitStatus("needs-model", message: "Retry Apple speech asset installation.")
        } catch {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await emitError(
                "unsupported_platform",
                "Apple speech assets could not be installed. Check network access and retry."
            )
            await emitStatus("needs-model", message: "Retry Apple speech asset installation.")
        }
    }

    private func generationMatches(_ expectedGeneration: UInt64) -> Bool {
        generation == expectedGeneration
    }
}
using System;
using System.IO;
using System.Linq;
using System.Text;
using Mochiya.AvatarTools.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// Exports the lilToon sample scene to a VRM with MOCHIYA_materials_liltoon, writes versions.json,
/// and renders the Unity reference capture. Each method takes the same -avatar and -preset arguments as the convert step.
/// Run: Unity -batchmode -quit -projectPath ... -executeMethod LilToonSampleExport.Run [-avatar Name]
/// Then: Unity -batchmode -quit -projectPath ... -executeMethod LilToonSampleExport.Capture [-avatar Name]
/// </summary>
public static class LilToonSampleExport
{
    public const int CaptureWidth = 1920;
    public const int CaptureHeight = 1080;

    [MenuItem("OpenSekai/Export lilToon sample")]
    public static void Run()
    {
        try
        {
            Export(LilToonSampleProfile.FromCommandLine());
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleExport failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    [MenuItem("OpenSekai/Capture lilToon reference")]
    public static void Capture()
    {
        try
        {
            CaptureReference(LilToonSampleProfile.FromCommandLine());
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleExport capture failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    [MenuItem("OpenSekai/Capture MToon original")]
    public static void CaptureOriginal()
    {
        try
        {
            CaptureOriginalReference(LilToonSampleProfile.FromCommandLine());
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleExport original capture failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    private static GameObject OpenSampleRoot(LilToonSampleProfile profile)
    {
        EditorSceneManager.OpenScene(profile.ScenePath, OpenSceneMode.Single);
        var root = GameObject.Find(profile.RootName);
        if (root == null) throw new InvalidOperationException($"No {profile.RootName} in {profile.ScenePath}. Run LilToonSampleConvert.Run first.");
        return root;
    }

    private static void Export(LilToonSampleProfile profile)
    {
        var root = OpenSampleRoot(profile);
        Directory.CreateDirectory(profile.ExportDirectory);
        var path = Path.Combine(profile.ExportDirectory, profile.ExportFileName);

        var detected = MochiyaAvatarWorkflow.Detect(root);
        Debug.Log($"Mochiya detect: kind={detected.Kind} prepared={detected.IsPrepared} reason={detected.Reason} error={detected.Error}");

        var exportProfile = ScriptableObject.CreateInstance<MochiyaExportProfile>();
        exportProfile.UseAttachedVrmMetadata = true;
        try
        {
            var report = MochiyaAvatarWorkflow.Export(root, path, exportProfile);
            Debug.Log($"Mochiya export report:\n{report}");
            if (!report.CanConvert) throw new InvalidOperationException(report.ToString());
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(exportProfile);
        }

        var size = new FileInfo(path).Length;
        Debug.Log($"Exported {path} ({size} bytes).");
        WriteVersions(profile, "mochiya");
    }

    private static void WriteVersions(LilToonSampleProfile profile, string exportPath)
    {
        var packages = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages();
        string Version(string name) => packages.FirstOrDefault(p => p.name == name)?.version ?? "unknown";
        string Commit(string name) => packages.FirstOrDefault(p => p.name == name)?.git?.hash ?? "unknown";
        var json = "{\n"
            + $"  \"unity\": \"{Application.unityVersion}\",\n"
            + $"  \"univrm\": \"{Version("com.vrmc.vrm")}\",\n"
            + $"  \"liltoon\": \"{Version("jp.lilxyzw.liltoon")}\",\n"
            + $"  \"mochiyaAvatarTools\": \"{Commit("org.mochiya.avatar-tools")}\",\n"
            + $"  \"exportPath\": \"{exportPath}\",\n"
            + $"  \"avatar\": \"{profile.Avatar}\",\n"
            + $"  \"preset\": \"{profile.Preset}\"\n"
            + "}\n";
        var file = Path.Combine(profile.ExportDirectory, "versions.json");
        File.WriteAllText(file, json, new UTF8Encoding(false));
        Debug.Log($"Wrote {file}:\n{json}");
    }

    // Renders the reference camera to a render texture and writes the PNG.
    // Batch mode has no Game view, so ScreenCapture.CaptureScreenshot is not used.
    private static void CaptureReference(LilToonSampleProfile profile)
    {
        var root = OpenSampleRoot(profile);
        var rig = LilToonSampleConvert.ReferenceRig(root, profile);
        var cameraObject = GameObject.Find(LilToonSampleConvert.CameraName);
        var lightObject = GameObject.Find(LilToonSampleConvert.LightName);
        if (cameraObject == null || lightObject == null) throw new InvalidOperationException("The sample scene has no reference camera or light.");
        var camera = cameraObject.GetComponent<Camera>();
        var light = lightObject.GetComponent<Light>();

        // Re-assert the reference values so that a hand edit of the scene does not change the capture.
        light.type = LightType.Directional;
        light.color = Color.white;
        light.intensity = LilToonSampleConvert.LightIntensity;
        light.shadows = LightShadows.None;
        lightObject.transform.rotation = Quaternion.Euler(LilToonSampleConvert.LightRotation);
        LilToonSampleConvert.ApplyReferenceAmbient(profile);
        cameraObject.transform.position = rig.Position;
        cameraObject.transform.LookAt(rig.Target);
        camera.fieldOfView = LilToonSampleConvert.CameraFieldOfView;
        camera.nearClipPlane = 0.05f;
        camera.farClipPlane = 20f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = LilToonSampleConvert.CameraBackground;
        camera.allowHDR = false;
        camera.allowMSAA = false;
        camera.aspect = (float)CaptureWidth / CaptureHeight;
        EditorSceneManager.SaveScene(cameraObject.scene);
        var forward = lightObject.transform.forward;
        Debug.Log($"Reference light forward: ({forward.x:F4}, {forward.y:F4}, {forward.z:F4}); camera MSAA off, quality antiAliasing {QualitySettings.antiAliasing}");
        RenderToPng(camera, profile, "unity-reference.png");
    }

    // Renders the unconverted MToon avatar with the same reference rig, in a new scene that is not saved.
    // The capture is the look that the lilToon conversion must keep. The new scene replaces the open scene.
    private static void CaptureOriginalReference(LilToonSampleProfile profile)
    {
        var prefab = LilToonSampleConvert.LoadSourcePrefab(profile);
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
        root.transform.position = Vector3.zero;
        root.transform.rotation = Quaternion.identity;
        var camera = LilToonSampleConvert.AddReferenceLightAndCamera(LilToonSampleConvert.ReferenceRig(root, profile), profile);
        camera.aspect = (float)CaptureWidth / CaptureHeight;
        var forward = RenderSettings.sun.transform.forward;
        Debug.Log($"Reference light forward: ({forward.x:F4}, {forward.y:F4}, {forward.z:F4}); camera MSAA off, quality antiAliasing {QualitySettings.antiAliasing}");
        RenderToPng(camera, profile, "unity-mtoon-original.png");
    }

    private static void RenderToPng(Camera camera, LilToonSampleProfile profile, string fileName)
    {
        ShaderUtil.allowAsyncCompilation = false;
        var rt = new RenderTexture(CaptureWidth, CaptureHeight, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default);
        var previousTarget = camera.targetTexture;
        var previousActive = RenderTexture.active;
        try
        {
            camera.targetTexture = rt;
            camera.Render();
            camera.Render();
            RenderTexture.active = rt;
            var image = new Texture2D(CaptureWidth, CaptureHeight, TextureFormat.RGBA32, false);
            image.ReadPixels(new Rect(0, 0, CaptureWidth, CaptureHeight), 0, 0);
            image.Apply();
            Directory.CreateDirectory(profile.ExportDirectory);
            var file = Path.Combine(profile.ExportDirectory, fileName);
            File.WriteAllBytes(file, image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
            Debug.Log($"Wrote {file} ({CaptureWidth}x{CaptureHeight}, color space {QualitySettings.activeColorSpace}).");
        }
        finally
        {
            camera.targetTexture = previousTarget;
            RenderTexture.active = previousActive;
            UnityEngine.Object.DestroyImmediate(rt);
        }
    }
}

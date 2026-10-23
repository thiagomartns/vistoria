namespace Vistoria.Api.Model;

/// <summary>Em andamento ou concluída (imutável). No JSON e no banco vai como string.</summary>
public enum InspectionStatus
{
    InProgress,
    Completed,
}

namespace Vistoria.Api.Model;

/// <summary>Condição de um item; nula até ser avaliado. No JSON e no banco vai como string.</summary>
public enum ItemCondition
{
    New,
    Good,
    Fair,
    Poor,
    Absent,
}
